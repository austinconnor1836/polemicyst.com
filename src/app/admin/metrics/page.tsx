'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

interface ByPlan {
  creator: number;
  pro: number;
  agency: number;
}

interface HistoryRow {
  date: string;
  mrrCents: number;
  arrCents: number;
  activeSubscriptions: number;
  newSubscriptions: number;
  churnedSubscriptions: number;
}

interface CohortRow {
  signupMonth: string;
  totalSignups: number;
  stillActive: number[];
}

interface MetricsResponse {
  today: {
    mrrCents: number;
    arrCents: number;
    activeSubscriptions: number;
    byPlan: ByPlan;
    churnPct30d: number;
  };
  history: HistoryRow[];
  cohort: CohortRow[];
}

function formatUsd(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) {
    return `$${dollars.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
  return `$${dollars.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function formatPct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

export default function AdminMetricsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL;

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
    fetch('/api/admin/metrics')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d: MetricsResponse) => {
        setData(d);
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [session, status, adminEmail, data]);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, status, adminEmail]);

  if (status === 'loading' || (loading && !data)) {
    return (
      <div className="max-w-5xl mx-auto px-3 sm:px-6 py-6">
        <Card className="border-dashed">
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="max-w-5xl mx-auto px-3 sm:px-6 py-6">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <p className="text-red-500 text-sm">{error}</p>
            <button
              onClick={fetchData}
              className="px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium"
            >
              Retry
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const { today, history, cohort } = data;
  const maxMrrCents = Math.max(...history.map((h) => h.mrrCents), 1);
  const maxPlanCount = Math.max(today.byPlan.creator, today.byPlan.pro, today.byPlan.agency, 1);

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg sm:text-2xl font-bold">Metrics</h1>
        <button
          onClick={fetchData}
          className="px-2.5 py-1 rounded-lg text-xs bg-muted text-muted-foreground active:bg-muted/60"
        >
          Refresh
        </button>
      </div>

      {/* Top stats row */}
      <Card>
        <CardHeader>
          <CardTitle>Today</CardTitle>
          <CardDescription>Live snapshot from User + latest rollup.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl p-3 bg-muted/20 border border-border/30">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">MRR</p>
              <p className="text-xl font-bold font-mono">{formatUsd(today.mrrCents)}</p>
            </div>
            <div className="rounded-xl p-3 bg-muted/20 border border-border/30">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">ARR</p>
              <p className="text-xl font-bold font-mono">{formatUsd(today.arrCents)}</p>
            </div>
            <div className="rounded-xl p-3 bg-muted/20 border border-border/30">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Active subs
              </p>
              <p className="text-xl font-bold font-mono">{today.activeSubscriptions}</p>
            </div>
            <div className="rounded-xl p-3 bg-muted/20 border border-border/30">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Churn 30d</p>
              <p className="text-xl font-bold font-mono">{formatPct(today.churnPct30d)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* MRR over time */}
      <Card>
        <CardHeader>
          <CardTitle>MRR over time</CardTitle>
          <CardDescription>Last 90 days of daily rollup rows.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-muted-foreground text-xs py-4 text-center">
              No rollup data yet. Bars will appear here as Stripe webhooks fire.
            </p>
          ) : (
            <div className="space-y-1">
              {history.map((h) => {
                const widthPct = Math.max(2, (h.mrrCents / maxMrrCents) * 100);
                return (
                  <div key={h.date} className="flex items-center gap-2 text-xs">
                    <span className="w-16 text-muted-foreground shrink-0 text-[10px]">
                      {new Date(h.date).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                    <div className="flex-1 h-4 bg-muted/30 rounded overflow-hidden">
                      <div
                        className="h-full bg-blue-500/70 rounded"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <span className="w-20 text-right font-mono shrink-0 text-[10px]">
                      {formatUsd(h.mrrCents)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Customer count by plan */}
      <Card>
        <CardHeader>
          <CardTitle>Customers by plan</CardTitle>
          <CardDescription>Active paid subscriptions split by tier.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {(['creator', 'pro', 'agency'] as const).map((plan) => {
              const count = today.byPlan[plan];
              const widthPct = Math.max(2, (count / maxPlanCount) * 100);
              return (
                <div key={plan} className="flex items-center gap-2 text-xs">
                  <span className="w-20 font-semibold capitalize shrink-0">{plan}</span>
                  <div className="flex-1 h-5 bg-muted/30 rounded overflow-hidden">
                    <div
                      className="h-full bg-emerald-500/70 rounded"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span className="w-12 text-right font-mono shrink-0">{count}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Cohort retention */}
      <Card>
        <CardHeader>
          <CardTitle>Cohort retention</CardTitle>
          <CardDescription>
            Monthly signups still on a paid plan. M0 = signup count; -- means month has not elapsed
            yet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-border/40 overflow-hidden">
            <div className="grid grid-cols-8 gap-1 px-2 py-1.5 bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
              <div className="col-span-2">Cohort</div>
              <div className="text-right">M0</div>
              <div className="text-right">M1</div>
              <div className="text-right">M2</div>
              <div className="text-right">M3</div>
              <div className="text-right">M4</div>
              <div className="text-right">M5</div>
            </div>
            {cohort.map((row) => (
              <div
                key={row.signupMonth}
                className="grid grid-cols-8 gap-1 px-2 py-2 text-xs items-center border-t border-border/30"
              >
                <div className="col-span-2 font-semibold">{row.signupMonth}</div>
                {row.stillActive.map((v, idx) => (
                  <div key={idx} className="text-right font-mono">
                    {v < 0 ? <span className="text-muted-foreground">--</span> : v}
                  </div>
                ))}
              </div>
            ))}
            {cohort.length === 0 && (
              <p className="text-muted-foreground text-xs py-4 text-center">No cohorts yet.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
