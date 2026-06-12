'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type CategoryRow = { category: string; amountUsd: number };
type ProjectionPoint = { month: string; balanceUsd: number };
type HistoryRow = {
  id: string;
  asOfDate: string;
  bankBalanceUsd: number;
  revenueLast30dUsd: number;
  source: string;
  notes: string | null;
};

type RunwayData = {
  currentBalanceUsd: number;
  monthlyRevenueUsd: number;
  monthlyBurnUsd: number;
  netBurnUsd: number;
  runwayMonths: number | null;
  runwayEndDate: string | null;
  asOfDate: string | null;
  activeUserCount: number;
  costPerActiveUserUsd: number;
  variableMonthlyBurn: number;
  fixedMonthlyBurn: number;
  fixedBreakdown: Record<string, number>;
  categoryBreakdown: CategoryRow[];
  projection: ProjectionPoint[];
  balanceHistory: HistoryRow[];
  observedDays: number;
};

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (Math.abs(n) >= 1000) {
    return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  return `$${n.toFixed(2)}`;
}

function formatCompactUsd(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function runwayColor(months: number | null): {
  badge: string;
  text: string;
  label: string;
} {
  if (months === null) {
    return {
      badge: 'bg-emerald-500/15 border-emerald-500/40',
      text: 'text-emerald-600 dark:text-emerald-400',
      label: 'Profitable',
    };
  }
  if (months >= 12) {
    return {
      badge: 'bg-emerald-500/15 border-emerald-500/40',
      text: 'text-emerald-600 dark:text-emerald-400',
      label: 'Healthy',
    };
  }
  if (months >= 6) {
    return {
      badge: 'bg-amber-500/15 border-amber-500/40',
      text: 'text-amber-600 dark:text-amber-400',
      label: 'Caution',
    };
  }
  return {
    badge: 'bg-red-500/15 border-red-500/40',
    text: 'text-red-600 dark:text-red-400',
    label: 'Critical',
  };
}

// Inline SVG line chart — no chart-library dep.
function ProjectionChart({ projection }: { projection: ProjectionPoint[] }) {
  const width = 800;
  const height = 240;
  const padding = { top: 16, right: 16, bottom: 28, left: 56 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const maxBal = Math.max(...projection.map((p) => p.balanceUsd), 1);
  const xStep = projection.length > 1 ? innerW / (projection.length - 1) : 0;

  const points = projection.map((p, i) => {
    const x = padding.left + i * xStep;
    const y = padding.top + innerH - (p.balanceUsd / maxBal) * innerH;
    return { x, y, ...p };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');

  const areaPath =
    linePath +
    ` L${points[points.length - 1].x.toFixed(1)},${(padding.top + innerH).toFixed(1)}` +
    ` L${points[0].x.toFixed(1)},${(padding.top + innerH).toFixed(1)} Z`;

  // y-axis grid lines (0%, 25%, 50%, 75%, 100%)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => ({
    y: padding.top + innerH - frac * innerH,
    value: maxBal * frac,
  }));

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[480px] h-auto"
        role="img"
        aria-label="12-month balance projection"
      >
        {yTicks.map((t) => (
          <g key={t.y}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={t.y}
              y2={t.y}
              className="stroke-border/50"
              strokeDasharray="2 4"
            />
            <text
              x={padding.left - 6}
              y={t.y + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              {formatCompactUsd(t.value)}
            </text>
          </g>
        ))}

        <path d={areaPath} className="fill-blue-500/10" />
        <path d={linePath} className="stroke-blue-500" strokeWidth={2} fill="none" />

        {points.map((p) => (
          <circle key={p.month} cx={p.x} cy={p.y} r={3} className="fill-blue-500">
            <title>{`${p.month}: ${formatUsd(p.balanceUsd)}`}</title>
          </circle>
        ))}

        {points.map((p, i) =>
          i % 2 === 0 ? (
            <text
              key={`label-${p.month}`}
              x={p.x}
              y={height - 8}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {p.month.slice(2)}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}

function CategoryBars({ rows }: { rows: CategoryRow[] }) {
  const total = rows.reduce((s, r) => s + r.amountUsd, 0);
  const max = Math.max(...rows.map((r) => r.amountUsd), 0.01);

  const COLORS: Record<string, string> = {
    LLM: 'bg-purple-500',
    S3: 'bg-blue-500',
    Compute: 'bg-emerald-500',
    DB: 'bg-amber-500',
    Hosting: 'bg-pink-500',
    Other: 'bg-zinc-500',
  };

  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const widthPct = Math.max(2, (r.amountUsd / max) * 100);
        const sharePct = total > 0 ? (r.amountUsd / total) * 100 : 0;
        const color = COLORS[r.category] ?? 'bg-zinc-500';
        return (
          <div key={r.category} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">{r.category}</span>
              <span className="font-mono text-muted-foreground">
                {formatUsd(r.amountUsd)} ({sharePct.toFixed(0)}%)
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted/40">
              <div className={`h-full rounded-full ${color}`} style={{ width: `${widthPct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminRunwayPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL;

  const [data, setData] = useState<RunwayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bankBalance, setBankBalance] = useState('');
  const [revenue, setRevenue] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user?.email || session.user.email !== adminEmail) {
      router.replace('/');
    }
  }, [session, status, router, adminEmail]);

  const fetchData = useCallback(() => {
    if (status === 'loading') return;
    if (!session?.user?.email || session.user.email !== adminEmail) return;

    setLoading((prev) => (data === null ? true : prev));
    fetch('/api/admin/runway')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d: RunwayData) => {
        setData(d);
        setError(null);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, status, adminEmail]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const parsedBalance = Number(bankBalance);
      if (!Number.isFinite(parsedBalance)) {
        toast.error('Enter a valid balance');
        return;
      }
      setSubmitting(true);
      try {
        const res = await fetch('/api/admin/runway/balance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bankBalanceUsd: parsedBalance,
            revenueLast30dUsd: revenue ? Number(revenue) : 0,
            notes: notes || undefined,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        toast.success('Balance updated');
        setBankBalance('');
        setRevenue('');
        setNotes('');
        fetchData();
      } catch (err) {
        toast.error((err as Error).message || 'Failed to save');
      } finally {
        setSubmitting(false);
      }
    },
    [bankBalance, revenue, notes, fetchData]
  );

  const runwayBadge = useMemo(() => runwayColor(data?.runwayMonths ?? null), [data?.runwayMonths]);

  if (status === 'loading' || (loading && !data)) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading runway…</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <p className="text-sm text-red-500">{error}</p>
            <Button onClick={fetchData}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const runwayLabel =
    data.runwayMonths === null ? 'Infinite' : `${data.runwayMonths.toFixed(1)} mo`;

  return (
    <div className="mx-auto max-w-5xl px-3 pb-32 pt-4 sm:px-6 sm:py-6 space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg sm:text-2xl font-bold">Runway &amp; Burn</h1>
          <p className="text-xs text-muted-foreground">
            {data.asOfDate
              ? `As of ${new Date(data.asOfDate).toLocaleDateString()}`
              : 'No balance recorded yet'}
            {data.observedDays < 30 && <> · burn scaled from {data.observedDays}d of cost data</>}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          Refresh
        </Button>
      </div>

      {/* Top stat cards — stack on mobile, 4-col on sm+ */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <Card>
          <CardContent className="p-3 sm:p-4 space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Current balance
            </p>
            <p className="text-xl sm:text-2xl font-bold">{formatUsd(data.currentBalanceUsd)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4 space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Monthly burn
            </p>
            <p className="text-xl sm:text-2xl font-bold">{formatUsd(data.monthlyBurnUsd)}</p>
            <p className="text-[10px] text-muted-foreground">
              {formatUsd(data.variableMonthlyBurn)} variable + {formatUsd(data.fixedMonthlyBurn)}{' '}
              fixed
            </p>
          </CardContent>
        </Card>
        <Card className={`border ${runwayBadge.badge}`}>
          <CardContent className="p-3 sm:p-4 space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Runway</p>
            <p className={`text-xl sm:text-2xl font-bold ${runwayBadge.text}`}>{runwayLabel}</p>
            <p className={`text-[10px] font-medium ${runwayBadge.text}`}>{runwayBadge.label}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4 space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Runway ends</p>
            <p className="text-xl sm:text-2xl font-bold">
              {data.runwayEndDate
                ? new Date(data.runwayEndDate).toLocaleDateString(undefined, {
                    month: 'short',
                    year: 'numeric',
                  })
                : '—'}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Net burn {formatUsd(data.netBurnUsd)}/mo
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Cost-per-active-user — investor-prominent */}
      <Card>
        <CardHeader>
          <CardTitle>Cost per active user</CardTitle>
          <CardDescription>
            Variable cost ÷ distinct users with cost events in last 30d.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-3xl sm:text-4xl font-bold">
              {formatUsd(data.costPerActiveUserUsd)}
            </span>
            <span className="text-sm text-muted-foreground">
              / user / month · {data.activeUserCount} active users
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Projection */}
      <Card>
        <CardHeader>
          <CardTitle>12-month balance projection</CardTitle>
          <CardDescription>
            Straight-line projection at current net burn ({formatUsd(data.netBurnUsd)}/mo). Assumes
            no new revenue and no cost changes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectionChart projection={data.projection} />
        </CardContent>
      </Card>

      {/* Expense breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Expense breakdown (last 30d)</CardTitle>
          <CardDescription>
            Variable (CostEvent) by category + fixed monthly overhead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CategoryBars rows={data.categoryBreakdown} />
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle>Balance history</CardTitle>
          <CardDescription>Last {data.balanceHistory.length} snapshots.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.balanceHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No snapshots recorded yet. Add one below.
            </p>
          ) : (
            <div className="space-y-1.5">
              {data.balanceHistory.map((h) => (
                <div
                  key={h.id}
                  className="flex flex-wrap items-center gap-2 rounded-md p-2 text-xs hover:bg-muted/30"
                >
                  <span className="w-24 shrink-0 font-mono text-muted-foreground">
                    {new Date(h.asOfDate).toLocaleDateString()}
                  </span>
                  <span className="flex-1 font-mono">{formatUsd(h.bankBalanceUsd)}</span>
                  <span className="text-muted-foreground">
                    rev {formatUsd(h.revenueLast30dUsd)}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {h.source}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sticky update form */}
      <form
        onSubmit={handleSubmit}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-end gap-2 px-3 py-2 sm:gap-3 sm:px-6 sm:py-3">
          <div className="min-w-[120px] flex-1 space-y-1">
            <Label htmlFor="balance" className="text-[10px] uppercase">
              Bank balance (USD)
            </Label>
            <Input
              id="balance"
              type="number"
              step="0.01"
              inputMode="decimal"
              placeholder="50000"
              value={bankBalance}
              onChange={(e) => setBankBalance(e.target.value)}
              required
              className="h-9"
            />
          </div>
          <div className="min-w-[120px] flex-1 space-y-1">
            <Label htmlFor="revenue" className="text-[10px] uppercase">
              Revenue last 30d (USD)
            </Label>
            <Input
              id="revenue"
              type="number"
              step="0.01"
              inputMode="decimal"
              placeholder="0"
              value={revenue}
              onChange={(e) => setRevenue(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="hidden min-w-[160px] flex-[2] space-y-1 sm:block">
            <Label htmlFor="notes" className="text-[10px] uppercase">
              Notes (optional)
            </Label>
            <Input
              id="notes"
              placeholder="Q3 funding closed"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="h-9"
            />
          </div>
          <Button type="submit" disabled={submitting} className="h-9">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Update balance'}
          </Button>
        </div>
      </form>
    </div>
  );
}
