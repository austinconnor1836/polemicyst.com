'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const POLL_INTERVAL_MS = 5_000;

type PollStatus = {
  feedId: string;
  lastPolledAt: string | null;
  nextPollAt: string | null;
  hasFirstVideo: boolean;
  videoCount: number;
};

type Props = {
  feedId: string;
  feedName?: string;
  onFirstVideo?: () => void;
};

export function PollingStatusBanner({ feedId, feedName, onFirstVideo }: Props) {
  // Defer first render to client to avoid hydration mismatch (status comes from network).
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [status, setStatus] = useState<PollStatus | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const stoppedRef = useRef(false);
  const firedRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Poll the status endpoint every 5s; stop once the first FeedVideo lands.
  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;

    const fetchOnce = async () => {
      try {
        const res = await fetch(`/api/connected-accounts/${feedId}/poll-status`);
        if (!res.ok) return;
        const data: PollStatus = await res.json();
        if (cancelled) return;
        setStatus(data);
        if (data.hasFirstVideo) {
          stoppedRef.current = true;
          if (!firedRef.current) {
            firedRef.current = true;
            onFirstVideo?.();
          }
        }
      } catch {
        // Network blip — swallow; next tick will try again.
      }
    };

    fetchOnce();
    const interval = window.setInterval(() => {
      if (stoppedRef.current) return;
      fetchOnce();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [feedId, mounted, onFirstVideo]);

  // Tick once per second so the "next check in Ns" countdown updates smoothly.
  useEffect(() => {
    if (!mounted) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(tick);
  }, [mounted]);

  if (!mounted || dismissed) return null;
  if (status?.hasFirstVideo) return null;

  const secondsUntilNextPoll = (() => {
    if (!status?.nextPollAt) return null;
    const target = new Date(status.nextPollAt).getTime();
    if (!Number.isFinite(target)) return null;
    const diff = Math.max(0, Math.round((target - now) / 1000));
    return diff;
  })();

  const sourceLabel = feedName ? feedName : 'your source';

  return (
    <div className="mb-6">
      <Card className="relative border-blue-200 bg-blue-50/60 dark:border-blue-900/60 dark:bg-blue-950/30 glass:border-blue-500/20 glass:bg-blue-950/20">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Loader2
                className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-blue-600 dark:text-blue-400"
                aria-hidden="true"
              />
              <div>
                <CardTitle className="text-base">Checking {sourceLabel}…</CardTitle>
                <CardDescription>
                  Videos usually appear in 1–5 minutes. We&apos;ll let you know when the first one
                  is ready.
                </CardDescription>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDismissed(true)}
              className="-mr-2 -mt-1 h-8 px-2 text-muted-foreground hover:text-foreground"
              title="Dismiss"
            >
              <X className="mr-1 h-4 w-4" />
              Dismiss
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {secondsUntilNextPoll !== null && <span>Next check in {secondsUntilNextPoll}s</span>}
            {status && (
              <span>
                {status.videoCount} video{status.videoCount === 1 ? '' : 's'} ingested so far
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
