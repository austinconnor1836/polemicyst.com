'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export interface HealthSnapshot {
  status: 'ok' | 'degraded' | string;
  db: string;
  redis: string;
  s3: string;
  timestamp: string;
}

const POLL_INTERVAL_MS = 30_000;

function isDev(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`}
    />
  );
}

function CheckRow({ label, value }: { label: string; value: string }) {
  const ok = value === 'ok';
  return (
    <div className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0 border-b border-border/30 last:border-0">
      <div className="flex items-center gap-2.5">
        <StatusDot ok={ok} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="text-right">
        {ok ? (
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
            Operational
          </span>
        ) : (
          <span
            className="text-xs font-medium text-red-600 dark:text-red-400 break-all max-w-[260px] inline-block"
            title={value}
          >
            {value}
          </span>
        )}
      </div>
    </div>
  );
}

interface Props {
  initial: HealthSnapshot | null;
  initialError: string | null;
}

export default function StatusLive({ initial, initialError }: Props) {
  const [data, setData] = useState<HealthSnapshot | null>(initial);
  const [fetchError, setFetchError] = useState<string | null>(initialError);
  const [lastChecked, setLastChecked] = useState<Date | null>(initial ? new Date() : null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        // /api/health returns 200 (ok) or 503 (degraded). Both have JSON bodies.
        const json = (await res.json()) as HealthSnapshot;
        if (cancelled) return;
        setData(json);
        setFetchError(null);
        setLastChecked(new Date());
      } catch (err) {
        if (cancelled) return;
        setFetchError(err instanceof Error ? err.message : 'Network error');
      }
    };

    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const allOk = data?.status === 'ok';
  const degraded = !!data && data.status !== 'ok';

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>System status</CardTitle>
              <CardDescription>
                Live health of the Clipfire API, queues, and object storage.
              </CardDescription>
            </div>
            {data ? (
              allOk ? (
                <Badge className="bg-emerald-500 text-white border-transparent hover:bg-emerald-500">
                  All systems operational
                </Badge>
              ) : (
                <Badge variant="destructive">Service degraded</Badge>
              )
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {fetchError && !data ? (
            <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
              <p className="font-medium text-yellow-700 dark:text-yellow-400">
                Status check failed
              </p>
              {isDev() ? (
                <p className="mt-1 text-xs text-yellow-700/80 dark:text-yellow-400/80 break-words">
                  {fetchError}
                </p>
              ) : (
                <p className="mt-1 text-xs text-yellow-700/80 dark:text-yellow-400/80">
                  Could not reach the health endpoint. Retrying.
                </p>
              )}
            </div>
          ) : null}

          {fetchError && data ? (
            <div className="mb-3 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs text-yellow-700 dark:text-yellow-400">
              Last refresh failed{isDev() ? `: ${fetchError}` : '.'} Showing previous result.
            </div>
          ) : null}

          {degraded && data ? (
            <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
              One or more checks reported a failure. See per-component status below.
            </div>
          ) : null}

          {data ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg border border-border/40 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
                  Database
                </p>
                <CheckRow label="PostgreSQL" value={data.db} />
              </div>
              <div className="rounded-lg border border-border/40 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
                  Redis (queues)
                </p>
                <CheckRow label="BullMQ" value={data.redis} />
              </div>
              <div className="rounded-lg border border-border/40 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
                  Object storage
                </p>
                <CheckRow label="S3" value={data.s3} />
              </div>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground mt-4">
            Status refreshes every 30 seconds. Underlying check at{' '}
            <code className="rounded bg-muted/40 px-1 py-0.5 text-[11px]">/api/health</code>.
            Production alarms forward to email — see internal{' '}
            <code className="rounded bg-muted/40 px-1 py-0.5 text-[11px]">docs/OPS.md</code>.
          </p>
          {lastChecked ? (
            <p className="text-[11px] text-muted-foreground mt-1">
              Last checked: {lastChecked.toLocaleTimeString()}
              {data?.timestamp ? ` (server timestamp ${data.timestamp})` : ''}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
