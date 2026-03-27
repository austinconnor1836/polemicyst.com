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

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 10);
  return `${m}:${String(sec).padStart(2, '0')}.${ms}`;
}

interface TrimModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoSrc: string;
  durationS: number;
  trimStartS: number;
  trimEndS: number | null;
  onSave: (trimStartS: number, trimEndS: number) => void;
  title?: string;
}

export function TrimModal({
  open,
  onOpenChange,
  videoSrc,
  durationS,
  trimStartS,
  trimEndS,
  onSave,
  title = 'Trim Video',
}: TrimModalProps) {
  const effectiveEnd = trimEndS ?? durationS;
  const [start, setStart] = useState(trimStartS);
  const [end, setEnd] = useState(effectiveEnd);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    handle: 'start' | 'end';
    startX: number;
    startStart: number;
    startEnd: number;
  } | null>(null);

  // Reset state when modal opens with new values
  useEffect(() => {
    if (open) {
      setStart(trimStartS);
      setEnd(trimEndS ?? durationS);
    }
  }, [open, trimStartS, trimEndS, durationS]);

  // Seek video when start changes
  useEffect(() => {
    if (videoRef.current && open) {
      videoRef.current.currentTime = start;
    }
  }, [start, open]);

  const startPct = durationS > 0 ? (start / durationS) * 100 : 0;
  const endPct = durationS > 0 ? (end / durationS) * 100 : 100;
  const rangePct = endPct - startPct;

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
        const newStart = Math.min(end - 0.5, Math.max(0, dragRef.current.startStart + dtS));
        setStart(newStart);
      } else {
        const newEnd = Math.max(start + 0.5, Math.min(durationS, dragRef.current.startEnd + dtS));
        setEnd(newEnd);
      }
    },
    [durationS, start, end]
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
      const distToStart = Math.abs(target - start);
      const distToEnd = Math.abs(target - end);
      if (distToStart <= distToEnd) {
        setStart(Math.min(target, end - 0.5));
      } else {
        setEnd(Math.max(target, start + 0.5));
      }
    },
    [durationS, start, end]
  );

  const handleSave = () => {
    onSave(start, end);
    onOpenChange(false);
  };

  const trimDuration = end - start;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
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
              <span className="font-medium text-foreground">
                {formatTime(trimDuration)} selected
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

              {/* Selected range highlight */}
              <div
                className="absolute inset-y-0 bg-blue-500/20 dark:bg-blue-400/20 pointer-events-none"
                style={{ left: `${startPct}%`, width: `${rangePct}%` }}
              />

              {/* Start handle */}
              <div
                role="button"
                tabIndex={0}
                className="absolute inset-y-0 w-3 -translate-x-1/2 cursor-ew-resize rounded bg-blue-500 dark:bg-blue-400 shadow-sm hover:bg-blue-600 dark:hover:bg-blue-300 transition-colors"
                style={{ left: `${startPct}%` }}
                onPointerDown={(e) => handlePointerDown(e, 'start')}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              />

              {/* End handle */}
              <div
                role="button"
                tabIndex={0}
                className="absolute inset-y-0 w-3 -translate-x-1/2 cursor-ew-resize rounded bg-blue-500 dark:bg-blue-400 shadow-sm hover:bg-blue-600 dark:hover:bg-blue-300 transition-colors"
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
        </div>

        <DialogFooter className="pt-4 gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Trim</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
