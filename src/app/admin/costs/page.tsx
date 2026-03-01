'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type StageRow = {
  stage: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgDurationMs: number;
  count: number;
};

type JobRow = {
  jobId: string;
  totalCostUsd: number;
  eventCount: number;
  createdAt: string;
};

type DailyRow = {
  day: string;
  totalCostUsd: number;
  eventCount: number;
};

type CostData = {
  totalUsd: number;
  totalEvents: number;
  days: number;
  byStage: StageRow[];
  byJob: JobRow[];
  daily: DailyRow[];
};

// Plan pricing for margin projections
const PLANS = [
  { name: 'Pro', priceUsd: 19, clipsPerMonth: 100 },
  { name: 'Business', priceUsd: 49, clipsPerMonth: 500 },
];

function formatUsd(n: number): string {
  if (n < 0.01 && n > 0) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function AdminCostsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL;

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user?.email || session.user.email !== adminEmail) {
      router.replace('/');
      return;
    }
  }, [session, status, router, adminEmail]);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user?.email || session.user.email !== adminEmail) return;

    setLoading(true);
    fetch(`/api/admin/costs?days=${days}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [days, session, status, adminEmail]);

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">Loading cost data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-red-500">Error: {error}</p>
      </div>
    );
  }

  if (!data) return null;

  const totalClips = data.byJob.length;
  const avgCostPerClip = totalClips > 0 ? data.totalUsd / totalClips : 0;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cost Dashboard</h1>
        <div className="flex gap-2">
          {[7, 14, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 rounded text-sm ${
                days === d
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Cost ({days}d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatUsd(data.totalUsd)}</p>
            <p className="text-xs text-muted-foreground">{data.totalEvents} events</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Jobs Tracked
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalClips}</p>
            <p className="text-xs text-muted-foreground">last {days} days</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Cost / Job
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatUsd(avgCostPerClip)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Per-stage breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Cost by Stage</CardTitle>
        </CardHeader>
        <CardContent>
          {data.byStage.length === 0 ? (
            <p className="text-muted-foreground text-sm">No cost events recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">Stage</th>
                    <th className="pb-2 pr-4 text-right">Cost</th>
                    <th className="pb-2 pr-4 text-right">Events</th>
                    <th className="pb-2 pr-4 text-right">Avg Duration</th>
                    <th className="pb-2 pr-4 text-right">Input Tokens</th>
                    <th className="pb-2 text-right">Output Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byStage.map((s) => (
                    <tr key={s.stage} className="border-b border-border/50">
                      <td className="py-2 pr-4">
                        <Badge variant="secondary">{s.stage}</Badge>
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">
                        {formatUsd(s.totalCostUsd)}
                      </td>
                      <td className="py-2 pr-4 text-right">{s.count}</td>
                      <td className="py-2 pr-4 text-right">
                        {s.avgDurationMs > 0 ? `${(s.avgDurationMs / 1000).toFixed(1)}s` : '-'}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">
                        {s.totalInputTokens > 0 ? formatTokens(s.totalInputTokens) : '-'}
                      </td>
                      <td className="py-2 text-right font-mono">
                        {s.totalOutputTokens > 0 ? formatTokens(s.totalOutputTokens) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-job table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {data.byJob.length === 0 ? (
            <p className="text-muted-foreground text-sm">No jobs recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">Job ID</th>
                    <th className="pb-2 pr-4 text-right">Cost</th>
                    <th className="pb-2 pr-4 text-right">Events</th>
                    <th className="pb-2 text-right">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byJob.map((j) => (
                    <tr key={j.jobId} className="border-b border-border/50">
                      <td className="py-2 pr-4 font-mono text-xs">{j.jobId.slice(0, 12)}...</td>
                      <td className="py-2 pr-4 text-right font-mono">
                        {formatUsd(j.totalCostUsd)}
                      </td>
                      <td className="py-2 pr-4 text-right">{j.eventCount}</td>
                      <td className="py-2 text-right text-muted-foreground">
                        {new Date(j.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Daily costs */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Costs</CardTitle>
        </CardHeader>
        <CardContent>
          {data.daily.length === 0 ? (
            <p className="text-muted-foreground text-sm">No daily data yet.</p>
          ) : (
            <div className="space-y-1">
              {data.daily.map((d) => {
                const maxCost = Math.max(...data.daily.map((r) => r.totalCostUsd), 0.001);
                const widthPct = Math.max(2, (d.totalCostUsd / maxCost) * 100);
                return (
                  <div key={d.day} className="flex items-center gap-3 text-sm">
                    <span className="w-24 text-muted-foreground shrink-0">
                      {new Date(d.day).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                    <div className="flex-1 h-5 bg-muted/30 rounded overflow-hidden">
                      <div
                        className="h-full bg-blue-500/70 rounded"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <span className="w-20 text-right font-mono shrink-0">
                      {formatUsd(d.totalCostUsd)}
                    </span>
                    <span className="w-12 text-right text-muted-foreground shrink-0">
                      {d.eventCount}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Margin projector */}
      <Card>
        <CardHeader>
          <CardTitle>Margin Projector</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Based on avg cost per job of {formatUsd(avgCostPerClip)}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4">Plan</th>
                  <th className="pb-2 pr-4 text-right">Price</th>
                  <th className="pb-2 pr-4 text-right">Clips/mo</th>
                  <th className="pb-2 pr-4 text-right">Est. Cost</th>
                  <th className="pb-2 pr-4 text-right">Margin</th>
                  <th className="pb-2 text-right">Margin %</th>
                </tr>
              </thead>
              <tbody>
                {PLANS.map((plan) => {
                  const estCost = avgCostPerClip * plan.clipsPerMonth;
                  const margin = plan.priceUsd - estCost;
                  const marginPct =
                    plan.priceUsd > 0 ? ((margin / plan.priceUsd) * 100).toFixed(1) : '0';
                  return (
                    <tr key={plan.name} className="border-b border-border/50">
                      <td className="py-2 pr-4 font-medium">{plan.name}</td>
                      <td className="py-2 pr-4 text-right">${plan.priceUsd}/mo</td>
                      <td className="py-2 pr-4 text-right">{plan.clipsPerMonth}</td>
                      <td className="py-2 pr-4 text-right font-mono">{formatUsd(estCost)}</td>
                      <td
                        className={`py-2 pr-4 text-right font-mono ${margin >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                      >
                        {formatUsd(margin)}
                      </td>
                      <td
                        className={`py-2 text-right ${margin >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                      >
                        {marginPct}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
