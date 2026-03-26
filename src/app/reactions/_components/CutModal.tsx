'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 10);
  return `${m}:${String(sec).padStart(2, '0')}.${ms}`;
}

export interface CompositionCut {
  id: string;
  startS: number;
  endS: number;
  targets: string[];
}

interface CutModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoSrc: string;
  durationS: number;
  existingCuts: CompositionCut[];
  availableTargets: Array<{ id: string; label: string }>;
  onSave: (cut: { startS: number; endS: number; targets: string[] }) => void;
}

export function CutModal({
  open,
  onOpenChange,
  videoSrc,
  durationS,
  existingCuts,
  availableTargets,
  onSave,
}: CutModalProps) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(Math.min(5, durationS));
  const [selectedTargets, setSelectedTargets] = useState<string[]>(() =>
    availableTargets.map((t) => t.id)
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    handle: 'start' | 'end';
    startX: number;
    startStart: number;
    startEnd: number;
  } | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setStart(0);
      setEnd(Math.min(5, durationS));
      setSelectedTargets(availableTargets.map((t) => t.id));
    }
  }, [open, durationS, availableTargets]);

  // Seek video when start changes
  useEffect(() => {
    if (videoRef.current && open) {
      videoRef.current.currentTime = start;
    }
  }, [start, open]);

  const startPct = durationS > 0 ? (start / durationS) * 100 : 0;
  const endPct = durationS > 0 ? (end / durationS) * 100 : 100;
  const rangePct = endPct - startPct;

  // Constrain a value to avoid overlapping existing cuts
  const constrainToGaps = useCallback(
    (value: number, handle: 'start' | 'end', otherHandle: number): number => {
      const sorted = [...existingCuts].sort((a, b) => a.startS - b.startS);
      let min = 0;
      let max = durationS;

      for (const cut of sorted) {
        if (handle === 'start') {
          // Start handle can't be inside an existing cut
          if (value >= cut.startS && value < cut.endS) {
            value = cut.endS;
          }
          // Can't place start such that it would overlap with an existing cut between start and end
        } else {
          // End handle can't be inside an existing cut
          if (value > cut.startS && value <= cut.endS) {
            value = cut.startS;
          }
        }
      }

      // Don't let range contain an existing cut
      if (handle === 'start') {
        // Find the closest existing cut that ends before `otherHandle` (end)
        for (const cut of sorted) {
          if (cut.startS >= value && cut.endS <= otherHandle) {
            // There's an existing cut between our start and end — constrain
            max = cut.startS;
            break;
          }
        }
        value = Math.min(value, max);
      } else {
        // Find the closest existing cut that starts after `otherHandle` (start)
        for (let i = sorted.length - 1; i >= 0; i--) {
          const cut = sorted[i];
          if (cut.endS <= value && cut.startS >= otherHandle) {
            min = cut.endS;
            break;
          }
        }
        value = Math.max(value, min);
      }

      return value;
    },
    [existingCuts, durationS]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, handle: 'start' | 'end') => {
      e.preventDefault();
      e.stopPropagation();
      if (e.currentTarget instanceof HTMLElement) {
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      dragRef.current = {
        handle,
        startX: e.clientX,
        startStart: start,
        startEnd: end,
      };
    },
    [start, end]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current || !timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      if (!rect.width) return;

      const dx = e.clientX - dragRef.current.startX;
      const dtS = (dx / rect.width) * durationS;

      if (dragRef.current.handle === 'start') {
        let newStart = Math.min(end - 0.5, Math.max(0, dragRef.current.startStart + dtS));
        newStart = constrainToGaps(newStart, 'start', end);
        setStart(newStart);
      } else {
        let newEnd = Math.max(start + 0.5, Math.min(durationS, dragRef.current.startEnd + dtS));
        newEnd = constrainToGaps(newEnd, 'end', start);
        setEnd(newEnd);
      }
    },
    [durationS, start, end, constrainToGaps]
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
  }, []);

  const handleTrackClick = useCallback(
    (e: React.PointerEvent) => {
      if (!timelineRef.current || durationS <= 0) return;
      const rect = timelineRef.current.getBoundingClientRect();
      if (!rect.width) return;
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const target = ratio * durationS;

      // Don't allow clicking inside existing cuts
      for (const cut of existingCuts) {
        if (target >= cut.startS && target <= cut.endS) return;
      }

      const distToStart = Math.abs(target - start);
      const distToEnd = Math.abs(target - end);
      if (distToStart <= distToEnd) {
        const newStart = constrainToGaps(Math.min(target, end - 0.5), 'start', end);
        setStart(newStart);
      } else {
        const newEnd = constrainToGaps(Math.max(target, start + 0.5), 'end', start);
        setEnd(newEnd);
      }
    },
    [durationS, start, end, existingCuts, constrainToGaps]
  );

  const toggleTarget = useCallback((targetId: string) => {
    setSelectedTargets((prev) => {
      if (prev.includes(targetId)) {
        return prev.filter((t) => t !== targetId);
      }
      return [...prev, targetId];
    });
  }, []);

  const handleSave = () => {
    if (selectedTargets.length === 0) return;
    onSave({ startS: start, endS: end, targets: selectedTargets });
    onOpenChange(false);
  };

  const cutDuration = end - start;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Remove Footage</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Video preview */}
          <div className="relative aspect-video bg-black rounded-md overflow-hidden">
            <video
              ref={videoRef}
              src={videoSrc}
              preload="metadata"
              playsInline
              controls
              className="h-full w-full object-contain"
            />
          </div>

          {/* Timeline */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{formatTime(start)}</span>
              <span className="font-medium text-red-500 dark:text-red-400">
                {formatTime(cutDuration)} to remove
              </span>
              <span>{formatTime(end)}</span>
            </div>

            <div
              ref={timelineRef}
              className="relative h-12 overflow-hidden rounded-lg border bg-muted/40"
              onPointerDown={handleTrackClick}
              onPointerMove={handlePointerMove}
            >
              {/* Segment background */}
              <div className="absolute inset-0 flex gap-0.5 p-1.5 pointer-events-none">
                {Array.from({ length: 32 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-full flex-1 rounded-sm bg-slate-200/80 dark:bg-slate-700/40"
                  />
                ))}
              </div>

              {/* Existing cuts shown as red blocks */}
              {existingCuts.map((cut) => {
                const cutStartPct = (cut.startS / durationS) * 100;
                const cutWidthPct = ((cut.endS - cut.startS) / durationS) * 100;
                return (
                  <div
                    key={cut.id}
                    className="absolute inset-y-0 bg-red-500/30 dark:bg-red-400/30 pointer-events-none border-x border-red-500/50"
                    style={{ left: `${cutStartPct}%`, width: `${cutWidthPct}%` }}
                  />
                );
              })}

              {/* New cut range highlight (red) */}
              <div
                className="absolute inset-y-0 bg-red-500/20 dark:bg-red-400/20 pointer-events-none"
                style={{ left: `${startPct}%`, width: `${rangePct}%` }}
              />

              {/* Start handle */}
              <div
                role="button"
                tabIndex={0}
                className="absolute inset-y-0 w-3 -translate-x-1/2 cursor-ew-resize rounded bg-red-500 dark:bg-red-400 shadow-sm hover:bg-red-600 dark:hover:bg-red-300 transition-colors"
                style={{ left: `${startPct}%` }}
                onPointerDown={(e) => handlePointerDown(e, 'start')}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              />

              {/* End handle */}
              <div
                role="button"
                tabIndex={0}
                className="absolute inset-y-0 w-3 -translate-x-1/2 cursor-ew-resize rounded bg-red-500 dark:bg-red-400 shadow-sm hover:bg-red-600 dark:hover:bg-red-300 transition-colors"
                style={{ left: `${endPct}%` }}
                onPointerDown={(e) => handlePointerDown(e, 'end')}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{formatTime(0)}</span>
              <span>{formatTime(durationS)}</span>
            </div>
          </div>

          {/* Target toggles */}
          {availableTargets.length > 1 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Apply to:</p>
              <div className="flex flex-wrap gap-2">
                {availableTargets.map((target) => {
                  const selected = selectedTargets.includes(target.id);
                  return (
                    <Badge
                      key={target.id}
                      variant={selected ? 'default' : 'outline'}
                      className={cn(
                        'cursor-pointer select-none transition-colors',
                        selected &&
                          'bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700'
                      )}
                      onClick={() => toggleTarget(target.id)}
                    >
                      {target.label}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="pt-4 gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleSave}
            disabled={selectedTargets.length === 0 || cutDuration < 0.1}
          >
            Remove Footage
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
