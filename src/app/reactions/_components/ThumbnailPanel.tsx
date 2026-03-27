'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Check, Download, Loader2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ThumbnailAsset {
  id: string;
  s3Url: string;
  frameTimestampS: number;
  visionScore: number | null;
  type: 'reference' | 'cutout';
}

type Position = 'left' | 'right';
type Size = 'small' | 'medium' | 'large';

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

// ---------------------------------------------------------------------------
// Size map for CSS preview positioning
// ---------------------------------------------------------------------------

const SIZE_PCT: Record<Size, number> = { small: 50, medium: 70, large: 85 };

// ---------------------------------------------------------------------------
// Skeleton grid while loading
// ---------------------------------------------------------------------------

function AssetSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-24 flex-shrink-0 rounded-md" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ThumbnailPanel({
  compositionId,
  compositionStatus,
  hideHeader,
  onGeneratingChange,
  regenerateRef,
}: ThumbnailPanelProps) {
  // Asset state
  const [referenceFrames, setReferenceFrames] = useState<ThumbnailAsset[]>([]);
  const [cutouts, setCutouts] = useState<ThumbnailAsset[]>([]);
  const [selectedRefId, setSelectedRefId] = useState<string | null>(null);
  const [selectedCutoutId, setSelectedCutoutId] = useState<string | null>(null);
  const [position, setPosition] = useState<Position>('right');
  const [size, setSize] = useState<Size>('large');
  const [compositeUrl, setCompositeUrl] = useState<string | null>(null);

  // Loading / saving state
  const [initialLoad, setInitialLoad] = useState(true);
  const [generating, setGeneratingRaw] = useState(false);
  const [saving, setSaving] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const pollCountRef = useRef(0);
  const prevStatusRef = useRef(compositionStatus);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  // ---------------------------------------------------------------------------
  // Fetch assets
  // ---------------------------------------------------------------------------

  const fetchAssets = useCallback(async () => {
    try {
      const res = await fetch(`/api/compositions/${compositionId}/thumbnail-assets`);
      if (!res.ok) return null;
      const data = await res.json();
      const refs: ThumbnailAsset[] = data.referenceFrames || [];
      const cuts: ThumbnailAsset[] = data.cutouts || [];
      setReferenceFrames(refs);
      setCutouts(cuts);

      // Restore settings
      if (data.settings) {
        setPosition(data.settings.position || 'right');
        setSize(data.settings.size || 'large');
      }
      if (data.compositeUrl) {
        setCompositeUrl(data.compositeUrl);
      }

      // Auto-select best if nothing selected yet (use functional updater to avoid stale closure)
      if (refs.length > 0) {
        setSelectedRefId((prev) => {
          if (prev) return prev;
          const best = refs.reduce((a, b) => ((b.visionScore ?? 0) > (a.visionScore ?? 0) ? b : a));
          return best.id;
        });
      }
      if (cuts.length > 0) {
        setSelectedCutoutId((prev) => {
          if (prev) return prev;
          const best = cuts.reduce((a, b) => ((b.visionScore ?? 0) > (a.visionScore ?? 0) ? b : a));
          return best.id;
        });
      }

      return { refs, cuts };
    } catch {
      return null;
    } finally {
      setInitialLoad(false);
    }
  }, [compositionId]);

  // Initial fetch
  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  // Clear when render starts; poll when render completes
  useEffect(() => {
    if (compositionStatus === 'rendering' && prevStatusRef.current !== 'rendering') {
      setReferenceFrames([]);
      setCutouts([]);
      setCompositeUrl(null);
      setSelectedRefId(null);
      setSelectedCutoutId(null);
      setGenerating(true);
    } else if (prevStatusRef.current === 'rendering' && compositionStatus === 'completed') {
      setGenerating(true);
    }
    prevStatusRef.current = compositionStatus;
  }, [compositionStatus, setGenerating]);

  // Poll while generating
  useEffect(() => {
    if (!generating) return;

    pollCountRef.current = 0;
    const poll = async () => {
      pollCountRef.current++;
      // 120 polls * 5s = 10 minutes (moondream + rembg can take 5+ minutes)
      if (pollCountRef.current > 120) {
        stopPolling();
        setGenerating(false);
        // Final fetch in case assets appeared right at timeout
        fetchAssets();
        return;
      }
      const data = await fetchAssets();
      if (data && (data.refs.length > 0 || data.cuts.length > 0)) {
        stopPolling();
        setGenerating(false);
      }
    };

    pollRef.current = setInterval(poll, 5000);
    return stopPolling;
  }, [generating, fetchAssets, stopPolling, setGenerating]);

  // ---------------------------------------------------------------------------
  // Debounced save — fires 800ms after any selection/setting change
  // ---------------------------------------------------------------------------

  const doComposite = useCallback(async () => {
    if (!selectedRefId || !selectedCutoutId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/compositions/${compositionId}/thumbnails/composite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceAssetId: selectedRefId,
          cutoutAssetId: selectedCutoutId,
          position,
          size,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Composite failed');
      }
      const data = await res.json();
      setCompositeUrl(data.s3Url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save thumbnail');
    } finally {
      setSaving(false);
    }
  }, [compositionId, selectedRefId, selectedCutoutId, position, size]);

  // Trigger debounced save when selections change
  const isInitialMount = useRef(true);
  useEffect(() => {
    // Skip on initial mount to avoid unnecessary save
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (!selectedRefId || !selectedCutoutId) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(doComposite, 800);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [selectedRefId, selectedCutoutId, position, size, doComposite]);

  // ---------------------------------------------------------------------------
  // Regenerate handler
  // ---------------------------------------------------------------------------

  const handleRegenerate = useCallback(async () => {
    setGenerating(true);
    setReferenceFrames([]);
    setCutouts([]);
    setCompositeUrl(null);
    setSelectedRefId(null);
    setSelectedCutoutId(null);
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

  // Expose regenerate handler to parent
  useEffect(() => {
    if (regenerateRef) {
      regenerateRef.current = handleRegenerate;
    }
    return () => {
      if (regenerateRef) regenerateRef.current = null;
    };
  }, [regenerateRef, handleRegenerate]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const isRendering = compositionStatus === 'rendering';
  const hasAssets = referenceFrames.length > 0 || cutouts.length > 0;
  const selectedRef = referenceFrames.find((r) => r.id === selectedRefId);
  const selectedCutout = cutouts.find((c) => c.id === selectedCutoutId);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4">
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Thumbnail Builder</span>
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
        <div className="space-y-4">
          <Skeleton className="aspect-video w-full rounded-lg" />
          <AssetSkeletonGrid />
          <AssetSkeletonGrid />
        </div>
      ) : !hasAssets ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {isRendering
            ? 'Thumbnails will be generated after render completes.'
            : 'No thumbnail assets generated yet.'}
        </p>
      ) : (
        <>
          {/* Live Preview */}
          <div
            className="relative mx-auto aspect-video w-full overflow-hidden rounded-lg border bg-muted"
            style={{ maxWidth: 640 }}
          >
            {selectedRef && (
              <img
                src={selectedRef.s3Url}
                alt="Reference frame background"
                className="absolute inset-0 h-full w-full object-cover"
                draggable={false}
              />
            )}
            {selectedCutout && (
              <img
                src={selectedCutout.s3Url}
                alt="Creator cutout"
                className="absolute bottom-0"
                draggable={false}
                style={{
                  height: `${SIZE_PCT[size]}%`,
                  ...(position === 'right'
                    ? { right: '12.5%', transform: 'translateX(50%)' }
                    : { left: '12.5%', transform: 'translateX(-50%)' }),
                }}
              />
            )}
            {!selectedRef && !selectedCutout && (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Select a reference frame and cutout below
              </div>
            )}
          </div>

          {/* Controls row */}
          <div className="flex flex-wrap items-center gap-4">
            {/* Position toggle */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Position</span>
              <div className="flex rounded-md border">
                <button
                  className={cn(
                    'px-2.5 py-1 text-xs transition-colors',
                    position === 'left' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  )}
                  onClick={() => setPosition('left')}
                >
                  Left
                </button>
                <button
                  className={cn(
                    'px-2.5 py-1 text-xs transition-colors',
                    position === 'right' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  )}
                  onClick={() => setPosition('right')}
                >
                  Right
                </button>
              </div>
            </div>

            {/* Size toggle */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Size</span>
              <div className="flex rounded-md border">
                {(['small', 'medium', 'large'] as const).map((s) => (
                  <button
                    key={s}
                    className={cn(
                      'px-2.5 py-1 text-xs transition-colors',
                      size === s ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                    )}
                    onClick={() => setSize(s)}
                  >
                    {s === 'small' ? 'S' : s === 'medium' ? 'M' : 'L'}
                  </button>
                ))}
              </div>
            </div>

            {/* Saving indicator */}
            <div className="ml-auto flex items-center gap-1.5">
              {saving && (
                <>
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Saving...</span>
                </>
              )}
            </div>
          </div>

          {/* Reference Frames grid */}
          {referenceFrames.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Reference Frames</span>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {referenceFrames.map((asset) => (
                  <button
                    key={asset.id}
                    onClick={() => setSelectedRefId(asset.id)}
                    className={cn(
                      'group relative flex-shrink-0 overflow-hidden rounded-md border-2 transition-all',
                      selectedRefId === asset.id
                        ? 'border-blue-500 ring-2 ring-blue-500/30'
                        : 'border-border hover:border-blue-300 dark:hover:border-blue-600'
                    )}
                  >
                    <img
                      src={asset.s3Url}
                      alt={`Reference frame at ${asset.frameTimestampS.toFixed(1)}s`}
                      className="h-16 w-24 object-cover"
                      loading="lazy"
                    />
                    {selectedRefId === asset.id && (
                      <div className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-white">
                        <Check className="h-2.5 w-2.5" />
                      </div>
                    )}
                    {asset.visionScore != null && (
                      <div className="absolute bottom-0.5 right-0.5 rounded bg-purple-600/80 px-1 py-px text-[9px] font-medium text-white">
                        {asset.visionScore.toFixed(1)}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Cutouts grid */}
          {cutouts.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Cutouts</span>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {cutouts.map((asset) => (
                  <button
                    key={asset.id}
                    onClick={() => setSelectedCutoutId(asset.id)}
                    className={cn(
                      'group relative flex-shrink-0 overflow-hidden rounded-md border-2 transition-all',
                      // Checkerboard background for transparency
                      'bg-[length:16px_16px] bg-[linear-gradient(45deg,#ccc_25%,transparent_25%,transparent_75%,#ccc_75%),linear-gradient(45deg,#ccc_25%,transparent_25%,transparent_75%,#ccc_75%)] bg-[position:0_0,8px_8px]',
                      'dark:bg-[linear-gradient(45deg,#333_25%,transparent_25%,transparent_75%,#333_75%),linear-gradient(45deg,#333_25%,transparent_25%,transparent_75%,#333_75%)]',
                      selectedCutoutId === asset.id
                        ? 'border-blue-500 ring-2 ring-blue-500/30'
                        : 'border-border hover:border-blue-300 dark:hover:border-blue-600'
                    )}
                  >
                    <img
                      src={asset.s3Url}
                      alt={`Creator cutout at ${asset.frameTimestampS.toFixed(1)}s`}
                      className="h-16 w-16 object-contain"
                      loading="lazy"
                    />
                    {selectedCutoutId === asset.id && (
                      <div className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-white">
                        <Check className="h-2.5 w-2.5" />
                      </div>
                    )}
                    {asset.visionScore != null && (
                      <div className="absolute bottom-0.5 right-0.5 rounded bg-purple-600/80 px-1 py-px text-[9px] font-medium text-white">
                        {asset.visionScore.toFixed(1)}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Download */}
          {compositeUrl && (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" asChild className="h-7 gap-1 text-xs">
                <a href={compositeUrl} download>
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
