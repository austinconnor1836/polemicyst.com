'use client';

import { useRef, useState, useCallback, useEffect, type RefObject } from 'react';
import { cn } from '@/lib/utils';

interface Track {
  id: string;
  label?: string | null;
  durationS: number;
  startAtS: number;
  trimStartS: number;
  trimEndS: number | null;
}

interface TimelineEditorProps {
  tracks: Track[];
  creatorDurationS: number;
  playheadRef?: RefObject<HTMLDivElement | null>;
  onTrackMove: (trackId: string, startAtS: number) => void;
  className?: string;
}

const SNAP_INTERVAL = 0.5;
const PX_PER_SECOND = 8;
const TRACK_HEIGHT = 36;

function snap(value: number): number {
  return Math.round(value / SNAP_INTERVAL) * SNAP_INTERVAL;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function TimelineEditor({
  tracks,
  creatorDurationS,
  playheadRef,
  onTrackMove,
  className,
}: TimelineEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ trackId: string; offsetX: number } | null>(null);

  const totalWidth = Math.max(creatorDurationS * PX_PER_SECOND, 400);

  // Generate time ruler marks every 10 seconds
  const marks: number[] = [];
  for (let t = 0; t <= creatorDurationS; t += 10) {
    marks.push(t);
  }

  const handleMouseDown = useCallback((e: React.MouseEvent, trackId: string, startAtS: number) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    setDragging({ trackId, offsetX });
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const scrollLeft = containerRef.current.scrollLeft;
      const x = e.clientX - containerRect.left + scrollLeft - dragging.offsetX;
      const seconds = snap(Math.max(0, x / PX_PER_SECOND));
      onTrackMove(dragging.trackId, seconds);
    },
    [dragging, onTrackMove]
  );

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  useEffect(() => {
    if (dragging) {
      const handleGlobalUp = () => setDragging(null);
      window.addEventListener('mouseup', handleGlobalUp);
      return () => window.removeEventListener('mouseup', handleGlobalUp);
    }
  }, [dragging]);

  const trackColors = [
    'bg-blue-500/80 dark:bg-blue-600/80',
    'bg-green-500/80 dark:bg-green-600/80',
    'bg-purple-500/80 dark:bg-purple-600/80',
    'bg-orange-500/80 dark:bg-orange-600/80',
    'bg-pink-500/80 dark:bg-pink-600/80',
    'bg-teal-500/80 dark:bg-teal-600/80',
    'bg-indigo-500/80 dark:bg-indigo-600/80',
    'bg-amber-500/80 dark:bg-amber-600/80',
    'bg-cyan-500/80 dark:bg-cyan-600/80',
    'bg-red-500/80 dark:bg-red-600/80',
  ];

  return (
    <div className={cn('rounded-lg border border-border bg-muted/20', className)}>
      <div className="px-3 py-2 border-b border-border">
        <p className="text-xs font-medium text-muted-foreground">Timeline</p>
      </div>
      <div
        ref={containerRef}
        className="overflow-x-auto"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          className="relative"
          style={{ width: totalWidth, minHeight: tracks.length * (TRACK_HEIGHT + 4) + 40 }}
        >
          {/* Time ruler */}
          <div className="relative h-6 border-b border-border">
            {marks.map((t) => (
              <div
                key={t}
                className="absolute top-0 flex flex-col items-center"
                style={{ left: t * PX_PER_SECOND }}
              >
                <div className="h-3 w-px bg-border" />
                <span className="text-[10px] text-muted-foreground">{formatTime(t)}</span>
              </div>
            ))}
          </div>

          {/* Playhead — positioned via ref from parent onTimeUpdate for zero re-renders */}
          <div
            ref={playheadRef as React.RefObject<HTMLDivElement>}
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none"
            style={{ left: 0 }}
          />

          {/* Track lanes */}
          {tracks.map((track, i) => {
            const effectiveDuration = (track.trimEndS ?? track.durationS) - track.trimStartS;
            const blockWidth = effectiveDuration * PX_PER_SECOND;
            const blockLeft = track.startAtS * PX_PER_SECOND;

            return (
              <div
                key={track.id}
                className="relative"
                style={{ height: TRACK_HEIGHT + 4, marginTop: i === 0 ? 4 : 0 }}
              >
                <div
                  className={cn(
                    'absolute rounded-sm cursor-move flex items-center px-2 text-white text-xs font-medium select-none',
                    trackColors[i % trackColors.length],
                    dragging?.trackId === track.id && 'ring-2 ring-white/50'
                  )}
                  style={{
                    left: blockLeft,
                    width: Math.max(blockWidth, 30),
                    height: TRACK_HEIGHT,
                    top: 2,
                  }}
                  onMouseDown={(e) => handleMouseDown(e, track.id, track.startAtS)}
                >
                  <span className="truncate">{track.label || `Ref ${i + 1}`}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
