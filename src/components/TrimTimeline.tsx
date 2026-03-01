'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Loader2, Play, Pause, Save, SkipBack, SkipForward } from 'lucide-react';

export interface TrimTimelineProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  durationS: number | null;
  trimStartS: number;
  trimEndS: number;
  trimDirty: boolean;
  isSaving: boolean;
  message: string | null;
  onTrimStartChange: (value: number) => void;
  onTrimEndChange: (value: number) => void;
  onSave: () => void;
}

export interface TrimTimelineHandle {
  updatePlayhead: (time: number) => void;
}

function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const sStr = s.toFixed(1).padStart(4, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sStr}` : `${m}:${sStr}`;
}

function parseTimecode(value: string): number | null {
  const parts = value.trim().split(':');
  if (parts.length === 0 || parts.length > 3) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
  if (parts.length === 2) return nums[0] * 60 + nums[1];
  return nums[0];
}

const THUMB_COUNT = 20;

const TrimTimeline = forwardRef<TrimTimelineHandle, TrimTimelineProps>(function TrimTimeline(
  {
    videoRef,
    durationS,
    trimStartS,
    trimEndS,
    trimDirty,
    isSaving,
    message,
    onTrimStartChange,
    onTrimEndChange,
    onSave,
  },
  ref
) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [playheadPos, setPlayheadPos] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [thumbsLoading, setThumbsLoading] = useState(false);
  const [startInput, setStartInput] = useState('');
  const [endInput, setEndInput] = useState('');
  const [editingStart, setEditingStart] = useState(false);
  const [editingEnd, setEditingEnd] = useState(false);
  const dragRef = useRef<{
    handle: 'start' | 'end';
    startX: number;
    startStart: number;
    startEnd: number;
  } | null>(null);
  const rafRef = useRef<number | null>(null);

  useImperativeHandle(ref, () => ({
    updatePlayhead(time: number) {
      setPlayheadPos(time);
    },
  }));

  useEffect(() => {
    if (!editingStart) setStartInput(formatTimecode(trimStartS));
  }, [trimStartS, editingStart]);

  useEffect(() => {
    if (!editingEnd) setEndInput(formatTimecode(trimEndS));
  }, [trimEndS, editingEnd]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
    };
  }, [videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let running = true;
    const tick = () => {
      if (!running) return;
      setPlayheadPos(video.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [videoRef]);

  const generateThumbnails = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !durationS || durationS <= 0) return;
    if (thumbnails.length > 0) return;
    setThumbsLoading(true);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setThumbsLoading(false);
      return;
    }

    const thumbWidth = 80;
    const thumbHeight = 45;
    canvas.width = thumbWidth;
    canvas.height = thumbHeight;

    const results: string[] = [];
    const tempVideo = document.createElement('video');
    tempVideo.crossOrigin = 'anonymous';
    tempVideo.preload = 'auto';
    tempVideo.muted = true;
    tempVideo.src = video.src;

    try {
      await new Promise<void>((resolve, reject) => {
        tempVideo.onloadeddata = () => resolve();
        tempVideo.onerror = () => reject(new Error('Failed to load video'));
        setTimeout(() => reject(new Error('Timeout')), 10000);
      });

      for (let i = 0; i < THUMB_COUNT; i++) {
        const time = (i / THUMB_COUNT) * durationS;
        tempVideo.currentTime = time;
        await new Promise<void>((resolve) => {
          const onSeeked = () => {
            tempVideo.removeEventListener('seeked', onSeeked);
            resolve();
          };
          tempVideo.addEventListener('seeked', onSeeked);
        });
        ctx.drawImage(tempVideo, 0, 0, thumbWidth, thumbHeight);
        results.push(canvas.toDataURL('image/jpeg', 0.5));
      }
      setThumbnails(results);
    } catch {
      // Thumbnail generation is best-effort (CORS may block cross-origin videos)
    } finally {
      tempVideo.pause();
      tempVideo.removeAttribute('src');
      tempVideo.load();
      setThumbsLoading(false);
    }
  }, [videoRef, durationS, thumbnails.length]);

  useEffect(() => {
    if (durationS && durationS > 0) generateThumbnails();
  }, [durationS, generateThumbnails]);

  const toPercent = useCallback(
    (s: number) => {
      if (!durationS || durationS <= 0) return 0;
      return Math.max(0, Math.min(100, (s / durationS) * 100));
    },
    [durationS]
  );

  const startPct = toPercent(trimStartS);
  const endPct = toPercent(trimEndS);
  const playheadPct = toPercent(playheadPos);
  const clipDuration = Math.max(0, trimEndS - trimStartS);

  const seekTo = useCallback(
    (time: number) => {
      const video = videoRef.current;
      if (video) video.currentTime = time;
    },
    [videoRef]
  );

  const handlePlaySelection = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = trimStartS;
    video.play();
  }, [videoRef, trimStartS]);

  const handleTogglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }, [videoRef]);

  const handleJumpStart = useCallback(() => seekTo(trimStartS), [seekTo, trimStartS]);
  const handleJumpEnd = useCallback(() => seekTo(trimEndS), [seekTo, trimEndS]);

  const handleTrackPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!trackRef.current || !durationS) return;
      e.preventDefault();
      const rect = trackRef.current.getBoundingClientRect();
      if (!rect.width) return;
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const target = ratio * durationS;
      const distS = Math.abs(target - trimStartS);
      const distE = Math.abs(target - trimEndS);
      if (distS <= distE) {
        onTrimStartChange(target);
        dragRef.current = {
          handle: 'start',
          startX: e.clientX,
          startStart: target,
          startEnd: trimEndS,
        };
      } else {
        onTrimEndChange(target);
        dragRef.current = {
          handle: 'end',
          startX: e.clientX,
          startStart: trimStartS,
          startEnd: target,
        };
      }
      trackRef.current.setPointerCapture(e.pointerId);
    },
    [durationS, trimStartS, trimEndS, onTrimStartChange, onTrimEndChange]
  );

  const handleHandlePointerDown = useCallback(
    (e: ReactPointerEvent, handle: 'start' | 'end') => {
      e.preventDefault();
      e.stopPropagation();
      if (e.currentTarget instanceof HTMLElement) {
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      dragRef.current = {
        handle,
        startX: e.clientX,
        startStart: trimStartS,
        startEnd: trimEndS,
      };
    },
    [trimStartS, trimEndS]
  );

  useEffect(() => {
    const onMove = (e: globalThis.PointerEvent) => {
      const state = dragRef.current;
      if (!state || !trackRef.current || !durationS) return;
      const rect = trackRef.current.getBoundingClientRect();
      if (!rect.width) return;
      const dx = (e.clientX - state.startX) / rect.width;
      const deltaS = dx * durationS;
      if (state.handle === 'start') {
        onTrimStartChange(state.startStart + deltaS);
      } else {
        onTrimEndChange(state.startEnd + deltaS);
      }
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [durationS, onTrimStartChange, onTrimEndChange]);

  const commitStartInput = useCallback(() => {
    setEditingStart(false);
    const parsed = parseTimecode(startInput);
    if (parsed != null) onTrimStartChange(parsed);
  }, [startInput, onTrimStartChange]);

  const commitEndInput = useCallback(() => {
    setEditingEnd(false);
    const parsed = parseTimecode(endInput);
    if (parsed != null) onTrimEndChange(parsed);
  }, [endInput, onTrimEndChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === ' ') {
        e.preventDefault();
        handleTogglePlay();
      }
      const nudge = e.shiftKey ? 1 : 0.1;
      if (e.key === '[' || e.key === '{') {
        e.preventDefault();
        onTrimStartChange(trimStartS - nudge);
      }
      if (e.key === ']' || e.key === '}') {
        e.preventDefault();
        onTrimEndChange(trimEndS + nudge);
      }
      if (e.key === 'ArrowLeft' && e.metaKey) {
        e.preventDefault();
        onTrimStartChange(trimStartS + nudge);
      }
      if (e.key === 'ArrowRight' && e.metaKey) {
        e.preventDefault();
        onTrimEndChange(trimEndS - nudge);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [trimStartS, trimEndS, onTrimStartChange, onTrimEndChange, handleTogglePlay]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={handleJumpStart}
            title="Jump to start"
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={handleTogglePlay}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={handleJumpEnd}
            title="Jump to end"
          >
            <SkipForward className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="ml-1"
            onClick={handlePlaySelection}
            title="Play trimmed selection"
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            Play selection
          </Button>
        </div>

        <div className="flex items-center gap-3 text-sm tabular-nums">
          <span className="rounded bg-muted/60 px-2 py-0.5 text-xs font-medium">
            Duration: {formatTimecode(clipDuration)}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatTimecode(playheadPos)} / {formatTimecode(durationS ?? 0)}
          </span>
        </div>
      </div>

      <div
        ref={trackRef}
        className="group relative h-14 cursor-pointer overflow-hidden rounded-lg border bg-muted/40 touch-none select-none sm:h-16"
        onPointerDown={handleTrackPointerDown}
      >
        {thumbnails.length > 0 ? (
          <div className="absolute inset-0 flex">
            {thumbnails.map((src, i) => (
              <img
                key={`thumb-${i}`}
                src={src}
                alt=""
                className="h-full flex-1 object-cover opacity-60"
                draggable={false}
              />
            ))}
          </div>
        ) : thumbsLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="absolute inset-0 flex gap-0.5 p-1.5 pointer-events-none">
            {Array.from({ length: 24 }).map((_, i) => (
              <div
                key={`seg-${i}`}
                className={cn(
                  'h-full flex-1 rounded-sm',
                  i % 3 === 0
                    ? 'bg-emerald-200/80 dark:bg-emerald-500/30'
                    : 'bg-slate-200/80 dark:bg-slate-700/40'
                )}
              />
            ))}
          </div>
        )}

        {durationS ? (
          <>
            <div
              className="pointer-events-none absolute inset-y-0 bg-black/40"
              style={{ left: 0, width: `${startPct}%` }}
            />
            <div
              className="pointer-events-none absolute inset-y-0 bg-black/40"
              style={{ left: `${endPct}%`, right: 0 }}
            />

            <div
              className="pointer-events-none absolute inset-y-0 border-y-2 border-primary/60"
              style={{
                left: `${startPct}%`,
                width: `${Math.max(0, endPct - startPct)}%`,
              }}
            />

            <div
              role="slider"
              tabIndex={0}
              aria-label="Trim start"
              aria-valuenow={trimStartS}
              className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize touch-none"
              style={{ left: `${startPct}%` }}
              onPointerDown={(e) => handleHandlePointerDown(e, 'start')}
            >
              <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded-full bg-primary shadow-md" />
              <div className="absolute left-1/2 top-0 -translate-x-1/2 rounded-b bg-primary px-1 py-px text-[9px] font-semibold leading-tight text-primary-foreground">
                IN
              </div>
            </div>

            <div
              role="slider"
              tabIndex={0}
              aria-label="Trim end"
              aria-valuenow={trimEndS}
              className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize touch-none"
              style={{ left: `${endPct}%` }}
              onPointerDown={(e) => handleHandlePointerDown(e, 'end')}
            >
              <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded-full bg-primary shadow-md" />
              <div className="absolute left-1/2 top-0 -translate-x-1/2 rounded-b bg-primary px-1 py-px text-[9px] font-semibold leading-tight text-primary-foreground">
                OUT
              </div>
            </div>

            <div
              className="pointer-events-none absolute inset-y-0 z-20 w-px bg-red-500"
              style={{ left: `${playheadPct}%` }}
            >
              <div className="absolute -left-1 -top-0.5 h-2 w-2 rounded-full bg-red-500" />
            </div>
          </>
        ) : null}
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{formatTimecode(0)}</span>
        <span>{formatTimecode(durationS ?? 0)}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:flex sm:items-end sm:gap-4">
        <div className="space-y-1">
          <Label htmlFor="trim-start" className="text-xs">
            In point
          </Label>
          <Input
            id="trim-start"
            className="h-8 font-mono text-xs"
            value={editingStart ? startInput : formatTimecode(trimStartS)}
            onFocus={() => {
              setEditingStart(true);
              setStartInput(formatTimecode(trimStartS));
            }}
            onChange={(e) => setStartInput(e.target.value)}
            onBlur={commitStartInput}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitStartInput();
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="trim-end" className="text-xs">
            Out point
          </Label>
          <Input
            id="trim-end"
            className="h-8 font-mono text-xs"
            value={editingEnd ? endInput : formatTimecode(trimEndS)}
            onFocus={() => {
              setEditingEnd(true);
              setEndInput(formatTimecode(trimEndS));
            }}
            onChange={(e) => setEndInput(e.target.value)}
            onBlur={commitEndInput}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEndInput();
            }}
          />
        </div>
        <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={onSave}
            disabled={!trimDirty || isSaving}
          >
            {isSaving ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            {isSaving ? 'Saving…' : 'Save trim'}
          </Button>
          {message ? (
            <span className="text-xs text-muted-foreground">{message}</span>
          ) : null}
        </div>
      </div>

      <div className="text-[10px] text-muted-foreground">
        <span className="hidden sm:inline">
          <kbd className="rounded border px-1 py-0.5 text-[9px]">Space</kbd> play/pause
          {' · '}
          <kbd className="rounded border px-1 py-0.5 text-[9px]">[</kbd>
          <kbd className="rounded border px-1 py-0.5 text-[9px]">]</kbd> nudge in/out
          {' · '}
          hold <kbd className="rounded border px-1 py-0.5 text-[9px]">Shift</kbd> for 1s steps
        </span>
      </div>
    </div>
  );
});

export default TrimTimeline;
