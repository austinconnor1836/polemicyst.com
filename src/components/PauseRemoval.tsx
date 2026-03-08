'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ChevronDown, Download, Loader2, Scissors, Volume2, VolumeX } from 'lucide-react';

type DetectedPause = {
  start: number;
  end: number;
  duration: number;
  confidence: number;
};

type PauseRemovalJobRecord = {
  id: string;
  status: string;
  estimatedPauseCount: number;
  detectedPauses?: DetectedPause[] | null;
  removedPauses?: DetectedPause[] | null;
  resultS3Url?: string | null;
  totalRemovedSeconds?: number | null;
  originalDurationS?: number | null;
  resultDurationS?: number | null;
  error?: string | null;
  createdAt: string;
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

export default function PauseRemoval({ feedVideoId }: { feedVideoId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [estimatedCount, setEstimatedCount] = useState(5);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jobs, setJobs] = useState<PauseRemovalJobRecord[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      setIsLoadingJobs(true);
      const res = await fetch(`/api/feedVideos/${feedVideoId}/pause-removal`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      }
    } catch {
      // silent
    } finally {
      setIsLoadingJobs(false);
    }
  }, [feedVideoId]);

  useEffect(() => {
    if (isOpen) {
      fetchJobs();
    }
  }, [isOpen, fetchJobs]);

  // Poll for active jobs
  useEffect(() => {
    if (!isOpen) return;
    const hasActive = jobs.some((j) => j.status === 'queued' || j.status === 'processing');
    if (!hasActive) return;
    const interval = window.setInterval(() => fetchJobs(), 5000);
    return () => window.clearInterval(interval);
  }, [isOpen, jobs, fetchJobs]);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitMessage(null);
    try {
      const res = await fetch(`/api/feedVideos/${feedVideoId}/pause-removal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estimatedPauseCount: estimatedCount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitMessage(data.error || 'Failed to start pause removal');
        return;
      }
      setSubmitMessage('Pause removal job queued!');
      await fetchJobs();
    } catch {
      setSubmitMessage('Failed to start pause removal');
    } finally {
      setIsSubmitting(false);
    }
  };

  const latestJob = jobs[0];
  const hasActiveJob = jobs.some((j) => j.status === 'queued' || j.status === 'processing');

  return (
    <Card>
      <CardHeader className="cursor-pointer select-none pb-3" onClick={() => setIsOpen((o) => !o)}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Pause Removal</CardTitle>
              {latestJob && (
                <Badge
                  variant={
                    latestJob.status === 'completed'
                      ? 'default'
                      : latestJob.status === 'failed'
                        ? 'destructive'
                        : 'secondary'
                  }
                >
                  {latestJob.status === 'queued'
                    ? 'Queued'
                    : latestJob.status === 'processing'
                      ? 'Processing…'
                      : latestJob.status === 'completed'
                        ? 'Done'
                        : 'Failed'}
                </Badge>
              )}
            </div>
            <CardDescription>
              Automatically remove dead space and silent pauses from the video.
            </CardDescription>
          </div>
          <ChevronDown
            className={cn(
              'h-5 w-5 text-muted-foreground transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
          />
        </div>
      </CardHeader>
      {isOpen && (
        <CardContent className="space-y-4">
          {/* Input form */}
          <div className="rounded-lg border p-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pause-count" className="text-sm font-medium">
                Roughly how many pauses should be removed?
              </Label>
              <p className="text-xs text-muted-foreground">
                Give a ballpark estimate. The system will use this to calibrate detection — it may
                remove fewer or more pauses than your estimate depending on the audio.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Input
                id="pause-count"
                type="number"
                min={1}
                max={500}
                value={estimatedCount}
                onChange={(e) => setEstimatedCount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">pauses</span>
              <Button onClick={handleSubmit} disabled={isSubmitting || hasActiveJob} size="sm">
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Starting…
                  </>
                ) : hasActiveJob ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    In progress…
                  </>
                ) : (
                  <>
                    <Scissors className="mr-2 h-4 w-4" />
                    Remove pauses
                  </>
                )}
              </Button>
            </div>
            {submitMessage && <p className="text-xs text-muted-foreground">{submitMessage}</p>}
          </div>

          {/* Results */}
          {isLoadingJobs && jobs.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading history…
            </div>
          )}

          {jobs.map((job) => (
            <PauseRemovalResult key={job.id} job={job} />
          ))}
        </CardContent>
      )}
    </Card>
  );
}

function PauseRemovalResult({ job }: { job: PauseRemovalJobRecord }) {
  const removedPauses = (job.removedPauses || []) as DetectedPause[];
  const detectedPauses = (job.detectedPauses || []) as DetectedPause[];

  if (job.status === 'queued' || job.status === 'processing') {
    return (
      <div className="rounded-lg border border-dashed p-4">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="font-medium">
            {job.status === 'queued' ? 'Waiting in queue…' : 'Analyzing audio and removing pauses…'}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Estimated ~{job.estimatedPauseCount} pauses to find
        </p>
      </div>
    );
  }

  if (job.status === 'failed') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 dark:border-red-900/50 dark:bg-red-950/20">
        <p className="text-sm font-medium text-red-800 dark:text-red-200">Pause removal failed</p>
        {job.error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{job.error}</p>}
      </div>
    );
  }

  if (job.status === 'completed') {
    return (
      <div className="rounded-lg border p-4 space-y-3">
        {/* Summary stats */}
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <VolumeX className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{removedPauses.length}</span>
            <span className="text-muted-foreground">pauses removed</span>
          </div>
          {job.totalRemovedSeconds != null && (
            <div className="flex items-center gap-1.5">
              <Scissors className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{formatDuration(job.totalRemovedSeconds)}</span>
              <span className="text-muted-foreground">cut</span>
            </div>
          )}
          {job.originalDurationS != null && job.resultDurationS != null && (
            <div className="text-muted-foreground">
              {formatDuration(job.originalDurationS)} → {formatDuration(job.resultDurationS)}
            </div>
          )}
          <div className="text-muted-foreground">(estimated ~{job.estimatedPauseCount})</div>
        </div>

        {/* Visual timeline */}
        {job.originalDurationS != null && job.originalDurationS > 0 && removedPauses.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Timeline</p>
            <div className="relative h-6 w-full rounded bg-emerald-100 dark:bg-emerald-900/30 overflow-hidden">
              {removedPauses.map((pause, i) => {
                const left = (pause.start / job.originalDurationS!) * 100;
                const width = (pause.duration / job.originalDurationS!) * 100;
                return (
                  <div
                    key={i}
                    className="absolute top-0 h-full bg-red-400/60 dark:bg-red-500/40"
                    style={{ left: `${left}%`, width: `${Math.max(width, 0.3)}%` }}
                    title={`${formatTimestamp(pause.start)} — ${formatTimestamp(pause.end)} (${pause.duration.toFixed(1)}s)`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0:00</span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-emerald-100 dark:bg-emerald-900/30 border" />
                Keep
                <span className="ml-2 inline-block h-2 w-2 rounded-sm bg-red-400/60 dark:bg-red-500/40 border" />
                Removed
              </span>
              <span>{formatTimestamp(job.originalDurationS!)}</span>
            </div>
          </div>
        )}

        {/* Removed pauses list */}
        {removedPauses.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
              {removedPauses.length} removed pause{removedPauses.length !== 1 ? 's' : ''} (click to
              expand)
            </summary>
            <div className="mt-2 max-h-40 overflow-y-auto rounded border text-xs">
              <table className="w-full">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium">#</th>
                    <th className="px-2 py-1 text-left font-medium">Start</th>
                    <th className="px-2 py-1 text-left font-medium">End</th>
                    <th className="px-2 py-1 text-left font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {removedPauses.map((p, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1">{i + 1}</td>
                      <td className="px-2 py-1">{formatTimestamp(p.start)}</td>
                      <td className="px-2 py-1">{formatTimestamp(p.end)}</td>
                      <td className="px-2 py-1">{p.duration.toFixed(1)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}

        {/* Download result */}
        {job.resultS3Url && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild size="sm" variant="secondary">
              <a href={job.resultS3Url} target="_blank" rel="noreferrer">
                <Volume2 className="mr-2 h-4 w-4" />
                Preview result
              </a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={job.resultS3Url} download>
                <Download className="mr-2 h-4 w-4" />
                Download
              </a>
            </Button>
          </div>
        )}

        {removedPauses.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No significant pauses were found to remove.
          </p>
        )}
      </div>
    );
  }

  return null;
}
