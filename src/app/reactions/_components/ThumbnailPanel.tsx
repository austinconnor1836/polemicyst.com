'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Check, Download, Loader2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

interface Thumbnail {
  id: string;
  s3Url: string;
  hookText: string;
  frameTimestampS: number;
  visionScore: number | null;
  selected: boolean;
}

interface ThumbnailPanelProps {
  compositionId: string;
  compositionStatus: string;
  /** When true, the internal header row is hidden (parent Card provides it). */
  hideHeader?: boolean;
  /** Called when the generating state changes — lets parent mirror the state for header buttons. */
  onGeneratingChange?: (generating: boolean) => void;
  /** Ref that the parent can call to trigger regeneration from an external button. */
  regenerateRef?: React.MutableRefObject<(() => void) | null>;
}

function ThumbnailSkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-lg border-2 border-border">
          <Skeleton className="aspect-video w-full" />
        </div>
      ))}
    </div>
  );
}

export function ThumbnailPanel({
  compositionId,
  compositionStatus,
  hideHeader,
  onGeneratingChange,
  regenerateRef,
}: ThumbnailPanelProps) {
  const [thumbnails, setThumbnails] = useState<Thumbnail[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [generating, setGeneratingRaw] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const pollCountRef = useRef(0);
  const prevStatusRef = useRef(compositionStatus);

  const setGenerating = useCallback(
    (value: boolean) => {
      setGeneratingRaw(value);
      onGeneratingChange?.(value);
    },
    [onGeneratingChange]
  );

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchThumbnails = useCallback(async () => {
    try {
      const res = await fetch(`/api/compositions/${compositionId}/thumbnails`);
      if (!res.ok) return null;
      const data: Thumbnail[] = await res.json();
      setThumbnails(data);
      return data;
    } catch {
      return null;
    } finally {
      setInitialLoad(false);
    }
  }, [compositionId]);

  // Initial fetch
  useEffect(() => {
    fetchThumbnails();
  }, [fetchThumbnails]);

  // Auto-start generating state when composition transitions rendering → completed
  useEffect(() => {
    if (prevStatusRef.current === 'rendering' && compositionStatus === 'completed') {
      setGenerating(true);
    }
    prevStatusRef.current = compositionStatus;
  }, [compositionStatus, setGenerating]);

  // Poll while generating — stops when thumbnails arrive or timeout
  useEffect(() => {
    if (!generating) return;

    pollCountRef.current = 0;
    const poll = async () => {
      pollCountRef.current++;
      if (pollCountRef.current > 24) {
        stopPolling();
        setGenerating(false);
        return;
      }
      const data = await fetchThumbnails();
      if (data && data.length > 0) {
        stopPolling();
        setGenerating(false);
      }
    };

    pollRef.current = setInterval(poll, 5000);
    return stopPolling;
  }, [generating, fetchThumbnails, stopPolling, setGenerating]);

  const handleSelect = async (thumbnailId: string) => {
    setSelecting(thumbnailId);
    try {
      const res = await fetch(`/api/compositions/${compositionId}/thumbnails`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thumbnailId }),
      });
      if (!res.ok) throw new Error('Failed to select');
      const data = await res.json();
      setThumbnails(data);
    } catch {
      toast.error('Failed to select thumbnail');
    } finally {
      setSelecting(null);
    }
  };

  const handleRegenerate = useCallback(async () => {
    setGenerating(true);
    setThumbnails([]);
    try {
      const res = await fetch(`/api/compositions/${compositionId}/thumbnails/regenerate`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to regenerate');
        setGenerating(false);
        return;
      }
      toast.success('Regenerating thumbnails...');
    } catch {
      toast.error('Failed to regenerate thumbnails');
      setGenerating(false);
    }
  }, [compositionId, setGenerating]);

  const selectedThumb = thumbnails.find((t) => t.selected);

  const isRendering = compositionStatus === 'rendering';

  // Expose regenerate handler to parent
  useEffect(() => {
    if (regenerateRef) {
      regenerateRef.current = handleRegenerate;
    }
    return () => {
      if (regenerateRef) regenerateRef.current = null;
    };
  }, [regenerateRef, handleRegenerate]);

  return (
    <div className="space-y-3">
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Thumbnails</span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={handleRegenerate}
            disabled={generating || isRendering}
          >
            {generating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Regenerate
          </Button>
        </div>
      )}

      {initialLoad || generating ? (
        <ThumbnailSkeletonGrid />
      ) : thumbnails.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          {isRendering
            ? 'Thumbnails will be generated after render completes.'
            : 'No thumbnails generated yet.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {thumbnails.map((thumb) => (
              <button
                key={thumb.id}
                onClick={() => handleSelect(thumb.id)}
                disabled={selecting !== null}
                className={cn(
                  'group relative overflow-hidden rounded-lg border-2 transition-all',
                  thumb.selected
                    ? 'border-blue-500 ring-2 ring-blue-500/30'
                    : 'border-border hover:border-blue-300 dark:hover:border-blue-600'
                )}
              >
                <img
                  src={thumb.s3Url}
                  alt={thumb.hookText || `Thumbnail at ${thumb.frameTimestampS.toFixed(1)}s`}
                  className="aspect-video w-full object-cover"
                  loading="lazy"
                />

                {/* Selection indicator */}
                {thumb.selected && (
                  <div className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-white">
                    <Check className="h-3 w-3" />
                  </div>
                )}

                {/* Selecting spinner */}
                {selecting === thumb.id && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                )}

                {/* Timestamp label */}
                <div className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                  {thumb.frameTimestampS.toFixed(1)}s
                </div>

                {/* Vision score badge */}
                {thumb.visionScore != null && (
                  <div className="absolute bottom-1 right-1 rounded bg-purple-600/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {thumb.visionScore.toFixed(1)}
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Download selected */}
          {selectedThumb && (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" asChild className="h-7 gap-1 text-xs">
                <a href={selectedThumb.s3Url} download>
                  <Download className="h-3 w-3" />
                  Download Thumbnail
                </a>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
