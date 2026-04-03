'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Flag, Loader2, Play, Pause, Scissors, X } from 'lucide-react';
import { spliceMP4, computeKeptSegments } from '@/lib/client-render';
import toast from 'react-hot-toast';

export interface CompositionCut {
  id: string;
  startS: number;
  endS: number;
}

interface EditOutputModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outputs: Array<{ id: string; layout: string; s3Url: string }>;
  outputBlobs: Map<string, Blob>;
  onSpliceComplete: (blobs: Map<string, Blob>, urls: Map<string, string>) => void;
  initialCuts?: CompositionCut[];
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 10);
  return `${m}:${String(sec).padStart(2, '0')}.${ms}`;
}

function formatTimeShort(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function generateCutId(): string {
  return `cut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function EditOutputModal({
  open,
  onOpenChange,
  outputs,
  outputBlobs,
  onSpliceComplete,
  initialCuts,
}: EditOutputModalProps) {
  const [localCuts, setLocalCuts] = useState<CompositionCut[]>(initialCuts ?? []);
  const [pendingStartS, setPendingStartS] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [splicing, setSplicing] = useState(false);
  const [spliceProgress, setSpliceProgress] = useState(0);

  const timelineRef = useRef<HTMLDivElement>(null);
  const primaryVideoRef = useRef<HTMLVideoElement>(null);
  const secondaryVideoRef = useRef<HTMLVideoElement>(null);

  const durationS = videoDuration;

  // Reset local state when modal opens
  useEffect(() => {
    if (open) {
      setLocalCuts([]);
      setPendingStartS(null);
      setCurrentTime(0);
      setVideoDuration(0);
      setIsPlaying(false);
      setSplicing(false);
      setSpliceProgress(0);
    }
  }, [open]);

  // Get video duration when metadata loads
  const handleLoadedMetadata = useCallback(() => {
    const vid = primaryVideoRef.current;
    if (vid && vid.duration && isFinite(vid.duration)) {
      setVideoDuration(vid.duration);
    }
  }, []);

  // Sync secondary video to primary
  const handleTimeUpdate = useCallback(() => {
    if (!primaryVideoRef.current) return;
    const t = primaryVideoRef.current.currentTime;
    setCurrentTime(t);
    if (secondaryVideoRef.current && Math.abs(secondaryVideoRef.current.currentTime - t) > 0.3) {
      secondaryVideoRef.current.currentTime = t;
    }
  }, []);

  // Unified play/pause
  const togglePlayPause = useCallback(() => {
    const primary = primaryVideoRef.current;
    const secondary = secondaryVideoRef.current;
    if (!primary) return;

    if (primary.paused) {
      primary.play().catch(() => {});
      secondary?.play().catch(() => {});
      setIsPlaying(true);
    } else {
      primary.pause();
      secondary?.pause();
      setIsPlaying(false);
    }
  }, []);

  // Keep play state in sync with video events
  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    secondaryVideoRef.current?.play().catch(() => {});
  }, []);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    if (secondaryVideoRef.current && !secondaryVideoRef.current.paused) {
      secondaryVideoRef.current.pause();
    }
  }, []);

  // Seek both videos
  const seekTo = useCallback((time: number) => {
    if (primaryVideoRef.current) primaryVideoRef.current.currentTime = time;
    if (secondaryVideoRef.current) secondaryVideoRef.current.currentTime = time;
    setCurrentTime(time);
  }, []);

  // Check if a time falls inside an existing cut
  const isInsideCut = useCallback(
    (time: number): boolean => {
      return localCuts.some((c) => time >= c.startS && time <= c.endS);
    },
    [localCuts]
  );

  // Mark Start
  const handleMarkStart = useCallback(() => {
    const t = primaryVideoRef.current?.currentTime ?? currentTime;
    if (isInsideCut(t)) {
      toast.error('Cannot start inside an existing cut');
      return;
    }
    setPendingStartS(t);
    toast('Start marked at ' + formatTime(t), { icon: '🚩', duration: 1500 });
  }, [currentTime, isInsideCut]);

  // Mark End
  const handleMarkEnd = useCallback(() => {
    if (pendingStartS === null) return;
    const t = primaryVideoRef.current?.currentTime ?? currentTime;

    let startS = Math.min(pendingStartS, t);
    let endS = Math.max(pendingStartS, t);

    if (endS - startS < 0.1) {
      toast.error('Play the video forward before marking the end');
      return;
    }

    // Clamp to not overlap existing cuts
    const sorted = [...localCuts].sort((a, b) => a.startS - b.startS);
    for (const cut of sorted) {
      if (startS >= cut.startS && startS < cut.endS) startS = cut.endS;
      if (endS > cut.startS && endS <= cut.endS) endS = cut.startS;
    }

    if (endS - startS < 0.1) {
      toast.error('Cut overlaps with existing cuts');
      setPendingStartS(null);
      return;
    }

    const newCut: CompositionCut = {
      id: generateCutId(),
      startS,
      endS,
    };

    setLocalCuts((prev) => [...prev, newCut].sort((a, b) => a.startS - b.startS));
    setPendingStartS(null);
    toast.success(
      `Cut added: ${formatTime(startS)} – ${formatTime(endS)} (${formatTime(endS - startS)})`,
      { duration: 2000 }
    );
  }, [pendingStartS, currentTime, localCuts]);

  const handleDeleteCut = useCallback((cutId: string) => {
    setLocalCuts((prev) => prev.filter((c) => c.id !== cutId));
  }, []);

  // Click timeline to seek
  const handleTimelineClick = useCallback(
    (e: React.MouseEvent) => {
      if (!timelineRef.current || durationS <= 0) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seekTo(ratio * durationS);
    },
    [durationS, seekTo]
  );

  // Apply Cuts — splice both outputs in parallel
  const handleApplyCuts = useCallback(async () => {
    if (localCuts.length === 0 || durationS <= 0) return;

    setSplicing(true);
    setSpliceProgress(0);

    try {
      const keptSegments = computeKeptSegments(
        0,
        durationS,
        localCuts.map((c) => ({ startS: c.startS, endS: c.endS }))
      );

      console.log('[EditOutputModal] Apply Cuts:', {
        durationS,
        localCuts: localCuts.map((c) => ({ startS: c.startS, endS: c.endS })),
        keptSegments,
        outputBlobs: Array.from(outputBlobs.entries()).map(([k, v]) => [
          k,
          `${(v.size / 1024 / 1024).toFixed(1)}MB`,
        ]),
      });

      if (keptSegments.length === 0) {
        toast.error('Cannot cut the entire video');
        setSplicing(false);
        return;
      }

      // Collect blobs for each output — fetch from S3 URL if no local blob
      const layoutBlobs = new Map<string, Blob>();
      for (const output of outputs) {
        const existing = outputBlobs.get(output.layout);
        if (existing) {
          layoutBlobs.set(output.layout, existing);
        } else {
          // Fetch from S3 URL
          const res = await fetch(output.s3Url);
          if (!res.ok) throw new Error(`Failed to fetch ${output.layout} output`);
          layoutBlobs.set(output.layout, await res.blob());
        }
      }

      // Splice all outputs in parallel
      const entries = Array.from(layoutBlobs.entries());
      const results = await Promise.all(
        entries.map(([layout, blob], i) =>
          spliceMP4(blob, keptSegments, (pct) => {
            // Average progress across all outputs
            setSpliceProgress(Math.round((i * 100 + pct) / entries.length));
          }).then((spliced) => ({ layout, spliced }))
        )
      );

      const newBlobs = new Map<string, Blob>();
      const newUrls = new Map<string, string>();
      for (const { layout, spliced } of results) {
        newBlobs.set(layout, spliced);
        newUrls.set(layout, URL.createObjectURL(spliced));
      }

      onSpliceComplete(newBlobs, newUrls);
      toast.success('Cuts applied successfully');
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[EditOutputModal] splice error:', err);
      toast.error(`Failed to apply cuts: ${msg}`);
    } finally {
      setSplicing(false);
      setSpliceProgress(0);
    }
  }, [localCuts, durationS, outputs, outputBlobs, onSpliceComplete, onOpenChange]);

  // Ruler marks
  const rulerInterval = durationS > 120 ? 30 : durationS > 30 ? 15 : 5;
  const rulerMarks: number[] = [];
  if (durationS > 0) {
    for (let t = 0; t <= durationS; t += rulerInterval) {
      rulerMarks.push(t);
    }
  }

  const playheadPct = durationS > 0 ? (currentTime / durationS) * 100 : 0;
  const pendingStartPct =
    pendingStartS !== null && durationS > 0 ? (pendingStartS / durationS) * 100 : null;
  const pendingRegion =
    pendingStartS !== null
      ? {
          left: Math.min(pendingStartS, currentTime),
          right: Math.max(pendingStartS, currentTime),
        }
      : null;

  const totalCutDuration = localCuts.reduce((sum, c) => sum + (c.endS - c.startS), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-[100vw] flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:rounded-none"
        aria-describedby={undefined}
      >
        {/* Sticky header */}
        <div className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
          <div>
            <DialogTitle className="text-base">Edit Output</DialogTitle>
            <DialogDescription className="text-xs">
              Mark Start / Mark End to select segments to remove.
            </DialogDescription>
          </div>
          {localCuts.length > 0 && (
            <Button size="sm" onClick={handleApplyCuts} disabled={splicing}>
              {splicing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Apply Cuts
            </Button>
          )}
        </div>

        {/* Video previews — fill remaining space */}
        <div className="flex min-h-0 flex-1 items-center justify-center gap-3 px-4 py-3 sm:px-6">
          {outputs.map((output, i) => {
            const isPortrait = output.layout === 'mobile';
            return (
              <div
                key={output.id}
                className={cn(
                  'bg-black rounded-md overflow-hidden h-full',
                  isPortrait ? 'aspect-[9/16]' : 'aspect-video'
                )}
              >
                <video
                  ref={i === 0 ? primaryVideoRef : secondaryVideoRef}
                  src={output.s3Url}
                  preload="auto"
                  playsInline
                  controls={false}
                  muted={i !== 0}
                  className="h-full w-full object-contain"
                  onLoadedMetadata={i === 0 ? handleLoadedMetadata : undefined}
                  onTimeUpdate={i === 0 ? handleTimeUpdate : undefined}
                  onPlay={i === 0 ? handlePlay : undefined}
                  onPause={i === 0 ? handlePause : undefined}
                />
              </div>
            );
          })}
        </div>

        {/* Controls + timeline pinned to bottom */}
        <div className="border-t px-4 py-3 sm:px-6">
          <div className="space-y-3">
            {/* Play/pause + marker buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={togglePlayPause}
                disabled={durationS <= 0}
              >
                {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {isPlaying ? 'Pause' : 'Play'}
              </Button>

              <div className="w-px h-5 bg-border" />

              {pendingStartS === null ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={handleMarkStart}
                  disabled={isInsideCut(currentTime)}
                >
                  <Flag className="h-3.5 w-3.5" />
                  Mark Start
                </Button>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-950/30 dark:text-red-300">
                    <Flag className="h-3 w-3" />
                    Start: {formatTime(pendingStartS)}
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5"
                    onClick={handleMarkEnd}
                  >
                    <Scissors className="h-3.5 w-3.5" />
                    Mark End
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => setPendingStartS(null)}
                  >
                    Cancel
                  </Button>
                </>
              )}
              <span className="ml-auto text-xs text-muted-foreground font-mono tabular-nums">
                {formatTime(currentTime)} / {formatTime(durationS)}
              </span>
            </div>

            {/* Timeline visualization */}
            {durationS > 0 && (
              <div className="space-y-1">
                <div
                  ref={timelineRef}
                  className="relative overflow-hidden rounded-lg border bg-muted/40 cursor-pointer"
                  style={{ height: 56 }}
                  onClick={handleTimelineClick}
                >
                  {/* Ruler */}
                  <div className="relative h-5 border-b border-border/50">
                    {rulerMarks.map((t) => {
                      const pct = (t / durationS) * 100;
                      return (
                        <div
                          key={t}
                          className="absolute top-0 flex flex-col items-center pointer-events-none"
                          style={{ left: `${pct}%` }}
                        >
                          <div className="h-2 w-px bg-border" />
                          <span className="text-[8px] text-muted-foreground/70 leading-none mt-px">
                            {formatTimeShort(t)}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Track area */}
                  <div className="relative mx-1" style={{ height: 28, marginTop: 1 }}>
                    <div className="absolute inset-x-0 top-1 bottom-1 rounded bg-muted/60" />

                    {/* Confirmed cut zones */}
                    {localCuts.map((cut) => {
                      const startPct = (cut.startS / durationS) * 100;
                      const widthPct = ((cut.endS - cut.startS) / durationS) * 100;
                      return (
                        <div
                          key={cut.id}
                          className="absolute top-0 bottom-0 group/cut"
                          style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                          onClick={(e) => {
                            e.stopPropagation();
                            seekTo(cut.startS);
                          }}
                        >
                          <div className="absolute inset-0 rounded-sm bg-red-500/30 dark:bg-red-400/25" />
                          <button
                            className="absolute -top-1.5 right-0 z-30 h-4 w-4 rounded-full bg-red-600 text-white opacity-0 group-hover/cut:opacity-100 transition-opacity flex items-center justify-center"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCut(cut.id);
                            }}
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <span className="text-[8px] font-medium text-red-700 dark:text-red-300 truncate px-0.5">
                              {formatTimeShort(cut.startS)}–{formatTimeShort(cut.endS)}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {/* Pending region preview */}
                    {pendingRegion && pendingRegion.right - pendingRegion.left > 0 && (
                      <div
                        className="absolute top-0 bottom-0 bg-red-500/15 border border-dashed border-red-400/50 rounded-sm pointer-events-none"
                        style={{
                          left: `${(pendingRegion.left / durationS) * 100}%`,
                          width: `${((pendingRegion.right - pendingRegion.left) / durationS) * 100}%`,
                        }}
                      />
                    )}

                    {/* Pending start marker */}
                    {pendingStartPct !== null && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none"
                        style={{ left: `${pendingStartPct}%` }}
                      >
                        <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-red-500 shadow" />
                      </div>
                    )}

                    {/* Playhead */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-white shadow-sm z-30 pointer-events-none"
                      style={{ left: `${playheadPct}%` }}
                    >
                      <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-white shadow" />
                    </div>
                  </div>
                </div>

                {/* Time labels */}
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{formatTimeShort(0)}</span>
                  {totalCutDuration > 0 && (
                    <span className="text-red-500 dark:text-red-400 font-medium">
                      {formatTime(totalCutDuration)} to remove
                    </span>
                  )}
                  <span>{formatTimeShort(durationS)}</span>
                </div>
              </div>
            )}

            {/* Cuts list */}
            {localCuts.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {localCuts.map((cut, i) => (
                  <span
                    key={cut.id}
                    className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/30 dark:text-red-300"
                  >
                    Cut {i + 1}: {formatTime(cut.startS)} – {formatTime(cut.endS)}
                    <button
                      onClick={() => handleDeleteCut(cut.id)}
                      className="ml-0.5 rounded-sm p-0.5 hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Splice progress */}
            {splicing && (
              <div className="space-y-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-[width] duration-300"
                    style={{ width: `${spliceProgress}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Applying cuts... {spliceProgress}%
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
