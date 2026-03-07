'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  const [showStages, setShowStages] = useState(false);
  const [showJobs, setShowJobs] = useState(false);
  const [showDaily, setShowDaily] = useState(false);
  const [showMargin, setShowMargin] = useState(false);

  const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL;

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user?.email || session.user.email !== adminEmail) {
      router.replace('/');
      return;
    }
  }, [session, status, router, adminEmail]);

  const fetchData = useCallback(() => {
    if (status === 'loading') return;
    if (!session?.user?.email || session.user.email !== adminEmail) return;

    setLoading((prev) => (data === null ? true : prev));
    fetch(`/api/admin/costs?days=${days}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [days, session, status, adminEmail, data]);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, session, status, adminEmail]);

  if (status === 'loading' || (loading && !data)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-2">
          <div className="w-6 h-6 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground text-sm">Loading costs...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <div className="text-center space-y-3">
          <p className="text-red-500 text-sm">{error}</p>
          <button
            onClick={fetchData}
            className="px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const totalClips = data.byJob.length;
  const avgCostPerClip = totalClips > 0 ? data.totalUsd / totalClips : 0;

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg sm:text-2xl font-bold">Costs</h1>
        <div className="flex items-center gap-1.5">
          <div className="flex gap-1">
            {[7, 14, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-2 py-1 rounded text-xs font-medium ${
                  days === d ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            onClick={fetchData}
            className="px-2.5 py-1 rounded-lg text-xs bg-muted text-muted-foreground active:bg-muted/60"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl p-3 bg-muted/20 border border-border/30 text-center">
          <p className="text-lg sm:text-xl font-bold">{formatUsd(data.totalUsd)}</p>
          <p className="text-[10px] sm:text-xs text-muted-foreground">Total ({days}d)</p>
        </div>
        <div className="rounded-xl p-3 bg-muted/20 border border-border/30 text-center">
          <p className="text-lg sm:text-xl font-bold">{totalClips}</p>
          <p className="text-[10px] sm:text-xs text-muted-foreground">Jobs</p>
        </div>
        <div className="rounded-xl p-3 bg-muted/20 border border-border/30 text-center">
          <p className="text-lg sm:text-xl font-bold">{formatUsd(avgCostPerClip)}</p>
          <p className="text-[10px] sm:text-xs text-muted-foreground">Avg/Job</p>
        </div>
      </div>

      {/* Collapsible: Cost by Stage */}
      <div className="rounded-xl border border-border/40 overflow-hidden">
        <button
          onClick={() => setShowStages(!showStages)}
          className="w-full flex items-center justify-between p-3 text-sm font-semibold active:bg-muted/30"
        >
          <span>Cost by Stage</span>
          <span className="text-muted-foreground text-xs">{showStages ? '−' : '+'}</span>
        </button>
        {showStages && (
          <div className="px-3 pb-3">
            {data.byStage.length === 0 ? (
              <p className="text-muted-foreground text-xs py-4 text-center">No cost events yet.</p>
            ) : (
              <div className="space-y-2">
                {data.byStage.map((s) => (
                  <div key={s.stage} className="flex items-center gap-2 text-xs">
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0 shrink-0 w-24 justify-center"
                    >
                      {s.stage}
                    </Badge>
                    <span className="font-mono flex-1">{formatUsd(s.totalCostUsd)}</span>
                    <span className="text-muted-foreground">{s.count} events</span>
                    {s.avgDurationMs > 0 && (
                      <span className="text-muted-foreground">
                        {(s.avgDurationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Collapsible: Recent Jobs */}
      <div className="rounded-xl border border-border/40 overflow-hidden">
        <button
          onClick={() => setShowJobs(!showJobs)}
          className="w-full flex items-center justify-between p-3 text-sm font-semibold active:bg-muted/30"
        >
          <span>Recent Jobs</span>
          <span className="text-muted-foreground text-xs">{showJobs ? '−' : '+'}</span>
        </button>
        {showJobs && (
          <div className="px-3 pb-3">
            {data.byJob.length === 0 ? (
              <p className="text-muted-foreground text-xs py-4 text-center">No jobs yet.</p>
            ) : (
              <div className="space-y-1.5">
                {data.byJob.map((j) => (
                  <div
                    key={j.jobId}
                    className="flex items-center gap-2 text-xs p-1.5 rounded-lg hover:bg-muted/20"
                  >
                    <span className="font-mono text-[10px] text-muted-foreground truncate w-20 shrink-0">
                      {j.jobId.slice(0, 10)}..
                    </span>
                    <span className="font-mono flex-1">{formatUsd(j.totalCostUsd)}</span>
                    <span className="text-muted-foreground">{j.eventCount} ev</span>
                    <span className="text-muted-foreground shrink-0">
                      {new Date(j.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Collapsible: Daily Costs */}
      <div className="rounded-xl border border-border/40 overflow-hidden">
        <button
          onClick={() => setShowDaily(!showDaily)}
          className="w-full flex items-center justify-between p-3 text-sm font-semibold active:bg-muted/30"
        >
          <span>Daily Costs</span>
          <span className="text-muted-foreground text-xs">{showDaily ? '−' : '+'}</span>
        </button>
        {showDaily && (
          <div className="px-3 pb-3">
            {data.daily.length === 0 ? (
              <p className="text-muted-foreground text-xs py-4 text-center">No daily data yet.</p>
            ) : (
              <div className="space-y-1">
                {data.daily.map((d) => {
                  const maxCost = Math.max(...data.daily.map((r) => r.totalCostUsd), 0.001);
                  const widthPct = Math.max(2, (d.totalCostUsd / maxCost) * 100);
                  return (
                    <div key={d.day} className="flex items-center gap-2 text-xs">
                      <span className="w-14 text-muted-foreground shrink-0 text-[10px]">
                        {new Date(d.day).toLocaleDateString('en-US', {
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
                      <span className="w-16 text-right font-mono shrink-0 text-[10px]">
                        {formatUsd(d.totalCostUsd)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Collapsible: Margin Projector */}
      <div className="rounded-xl border border-border/40 overflow-hidden">
        <button
          onClick={() => setShowMargin(!showMargin)}
          className="w-full flex items-center justify-between p-3 text-sm font-semibold active:bg-muted/30"
        >
          <span>Margin Projector</span>
          <span className="text-muted-foreground text-xs">{showMargin ? '−' : '+'}</span>
        </button>
        {showMargin && (
          <div className="px-3 pb-3">
            <p className="text-[10px] text-muted-foreground mb-3">
              Based on avg cost per job of {formatUsd(avgCostPerClip)}
            </p>
            <div className="space-y-3">
              {PLANS.map((plan) => {
                const estCost = avgCostPerClip * plan.clipsPerMonth;
                const margin = plan.priceUsd - estCost;
                const marginPct =
                  plan.priceUsd > 0 ? ((margin / plan.priceUsd) * 100).toFixed(1) : '0';
                return (
                  <div key={plan.name} className="rounded-lg bg-muted/20 p-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold">{plan.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ${plan.priceUsd}/mo · {plan.clipsPerMonth} clips
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-muted-foreground">Est. cost: {formatUsd(estCost)}</span>
                      <span
                        className={`font-mono font-semibold ${margin >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                      >
                        {formatUsd(margin)} ({marginPct}%)
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
