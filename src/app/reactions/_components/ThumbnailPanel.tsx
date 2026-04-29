'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Check, Crop, Download, ImagePlus, Loader2, RefreshCw, Wand2 } from 'lucide-react';
import { ThumbnailCropModal } from './ThumbnailCropModal';
import toast from 'react-hot-toast';
import { extractFrames } from '@/lib/client-render/extract-frames';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ThumbnailAsset {
  id: string;
  s3Url: string;
  frameTimestampS: number;
  visionScore: number | null;
  type: 'reference' | 'cutout' | 'ai_background' | 'custom_background';
  styleVariant?: string | null;
}

type Position = 'left' | 'right';
type Size = 'small' | 'medium' | 'large';
type BgMode = 'frame' | 'ai' | 'custom';

interface ThumbnailPanelProps {
  compositionId: string;
  compositionStatus: string;
  /** When true, the internal header row is hidden (parent Card provides it). */
  hideHeader?: boolean;
  /** Called when the generating state changes — lets parent mirror the state for header buttons. */
  onGeneratingChange?: (generating: boolean) => void;
  /** Ref that the parent can call to trigger regeneration from an external button. */
  regenerateRef?: React.MutableRefObject<(() => void) | null>;
  /** @deprecated No longer used — thumbnails no longer regenerate on re-render. */
  skipAutoGenerate?: boolean;
  /** Local creator video file for client-side frame extraction */
  creatorFile?: File | null;
  /** Local reference video files for client-side frame extraction */
  refFiles?: Map<string, File>;
  /** Called whenever the composite thumbnail URL changes — lets parent track the active thumbnail. */
  onCompositeUrlChange?: (url: string | null) => void;
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
// Cropped background preview — draws only the crop rect, scaled to fill
// ---------------------------------------------------------------------------

function CroppedBgPreview({
  imageUrl,
  crop,
}: {
  imageUrl: string;
  crop: { x: number; y: number; w: number; h: number };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    const img = new Image();
    img.onload = () => {
      if (cancelled || !canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Match canvas pixel size to display size
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * (window.devicePixelRatio || 1));
      canvas.height = Math.round(rect.height * (window.devicePixelRatio || 1));

      // Draw the cropped region centered with padding (not stretched) to match 16:9
      const TARGET_AR = 16 / 9;
      const cropAR = crop.w / crop.h;

      // Fill with dark background for padding areas
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let drawW: number, drawH: number, drawX: number, drawY: number;
      if (cropAR > TARGET_AR) {
        // Crop is wider than 16:9 → fit to width, pad top/bottom
        drawW = canvas.width;
        drawH = (canvas.width / crop.w) * crop.h;
        drawX = 0;
        drawY = (canvas.height - drawH) / 2;
      } else {
        // Crop is taller than 16:9 → fit to height, pad left/right
        drawH = canvas.height;
        drawW = (canvas.height / crop.h) * crop.w;
        drawX = (canvas.width - drawW) / 2;
        drawY = 0;
      }

      ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, drawX, drawY, drawW, drawH);
    };
    img.src = imageUrl;

    return () => {
      cancelled = true;
    };
  }, [imageUrl, crop]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
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
  skipAutoGenerate,
  creatorFile,
  refFiles,
  onCompositeUrlChange,
}: ThumbnailPanelProps) {
  // Asset state
  const [referenceFrames, setReferenceFrames] = useState<ThumbnailAsset[]>([]);
  const [cutouts, setCutouts] = useState<ThumbnailAsset[]>([]);
  const [aiBackgrounds, setAiBackgrounds] = useState<ThumbnailAsset[]>([]);
  const [customBackgrounds, setCustomBackgrounds] = useState<ThumbnailAsset[]>([]);
  const [selectedRefId, setSelectedRefId] = useState<string | null>(null);
  const [selectedCutoutId, setSelectedCutoutId] = useState<string | null>(null);
  const [position, setPosition] = useState<Position>('right');
  const [size, setSize] = useState<Size>('large');
  const [bgMode, setBgMode] = useState<BgMode>('frame');
  const [generatingAi, setGeneratingAi] = useState(false);
  const [uploadingCustomBg, setUploadingCustomBg] = useState(false);
  const [compositeUrl, setCompositeUrl] = useState<string | null>(null);
  const [bgCrop, setBgCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const customBgInputRef = useRef<HTMLInputElement | null>(null);

  // Loading / saving state
  const [initialLoad, setInitialLoad] = useState(true);
  const [initialFetchDone, setInitialFetchDone] = useState(false);
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

  // Notify parent whenever compositeUrl changes
  useEffect(() => {
    onCompositeUrlChange?.(compositeUrl);
  }, [compositeUrl, onCompositeUrlChange]);

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
      const aiBgs: ThumbnailAsset[] = data.aiBackgrounds || [];
      const customBgs: ThumbnailAsset[] = data.customBackgrounds || [];
      setReferenceFrames(refs);
      setCutouts(cuts);
      setAiBackgrounds(aiBgs);
      setCustomBackgrounds(customBgs);

      // Restore settings
      if (data.settings) {
        setPosition(data.settings.position || 'right');
        setSize(data.settings.size || 'large');
        if (
          data.settings.bgMode === 'ai' ||
          data.settings.bgMode === 'frame' ||
          data.settings.bgMode === 'custom'
        ) {
          setBgMode(data.settings.bgMode);
        }
        if (data.settings.bgCrop) {
          setBgCrop(data.settings.bgCrop);
        }
      }
      if (data.compositeUrl) {
        setCompositeUrl(data.compositeUrl);
      }

      // Auto-select a background from the restored mode if nothing is selected yet.
      setSelectedRefId((prev) => {
        if (prev) return prev;
        const restoredMode = data.settings?.bgMode;
        if (restoredMode === 'custom' && customBgs.length > 0) return customBgs[0].id;
        if (restoredMode === 'ai' && aiBgs.length > 0) return aiBgs[0].id;
        if (refs.length === 0) return prev;
        const best = refs.reduce((a, b) => ((b.visionScore ?? 0) > (a.visionScore ?? 0) ? b : a));
        return best.id;
      });
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

  // Initial fetch — if composition is completed but no assets exist, resume polling
  // (handles page refresh while worker is still running)
  useEffect(() => {
    fetchAssets().then((data) => {
      setInitialFetchDone(true);
      if (data && (data.refs.length > 0 || data.cuts.length > 0)) {
        // Assets already exist on server — skip local extraction
        localExtractedRef.current = true;
      } else if (
        compositionStatus === 'completed' &&
        data &&
        data.refs.length === 0 &&
        data.cuts.length === 0
      ) {
        setGenerating(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Extract frames from local files → upload to server for moondream + rembg processing.
  // Starts as soon as local files are available (doesn't wait for render to complete).
  const localExtractedRef = useRef(false);
  useEffect(() => {
    // Wait until initial fetch resolves so we know whether assets already exist on the server
    if (!initialFetchDone) return;
    // Only trigger once
    if (localExtractedRef.current) return;

    const refFile = refFiles?.values().next().value as File | undefined;
    if (!creatorFile && !refFile) return;

    localExtractedRef.current = true;
    setGenerating(true);

    (async () => {
      try {
        // Extract candidate frames client-side (~20 each for scoring variety)
        const formData = new FormData();

        if (refFile) {
          const refFrames = await extractFrames(refFile, 20);
          const refTimestamps: number[] = [];
          for (const frame of refFrames) {
            formData.append(
              'referenceFrames',
              frame.blob,
              `ref_${frame.timestampS.toFixed(2)}.jpg`
            );
            refTimestamps.push(frame.timestampS);
          }
          formData.append('refTimestamps', JSON.stringify(refTimestamps));
        }

        if (creatorFile) {
          const creatorFrames = await extractFrames(creatorFile, 20);
          const creatorTimestamps: number[] = [];
          for (const frame of creatorFrames) {
            formData.append(
              'creatorFrames',
              frame.blob,
              `creator_${frame.timestampS.toFixed(2)}.jpg`
            );
            creatorTimestamps.push(frame.timestampS);
          }
          formData.append('creatorTimestamps', JSON.stringify(creatorTimestamps));
        }

        // Upload frames to S3 and queue server-side thumbnail generation
        const res = await fetch(
          `/api/compositions/${compositionId}/thumbnails/generate-from-frames`,
          { method: 'POST', body: formData }
        );

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.error('[ThumbnailPanel] Frame upload failed:', data.error);
          toast.error('Failed to generate thumbnails');
          setGenerating(false);
          return;
        }

        // Polling will pick up results once the worker processes the frames
        console.log('[ThumbnailPanel] Frames uploaded, waiting for server processing...');
      } catch (err) {
        console.error('[ThumbnailPanel] Local frame extraction/upload failed:', err);
        toast.error('Failed to extract frames');
        setGenerating(false);
      }
    })();
  }, [initialFetchDone, compositionId, creatorFile, refFiles, setGenerating]);

  // Track status for other effects but do NOT clear/regenerate thumbnails on re-render.
  // Thumbnails are independent of the video render and persist across re-renders.
  useEffect(() => {
    prevStatusRef.current = compositionStatus;
  }, [compositionStatus]);

  // Poll while generating
  useEffect(() => {
    if (!generating) return;

    pollCountRef.current = 0;
    const poll = async () => {
      pollCountRef.current++;
      // 240 polls * 5s = 20 minutes (moondream on CPU can take 2min/frame × 8 frames + rembg)
      if (pollCountRef.current > 240) {
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

  // Reset bgCrop when selected reference frame changes
  const prevRefIdRef = useRef(selectedRefId);
  useEffect(() => {
    if (prevRefIdRef.current !== null && selectedRefId !== prevRefIdRef.current) {
      setBgCrop(null);
    }
    prevRefIdRef.current = selectedRefId;
  }, [selectedRefId]);

  // ---------------------------------------------------------------------------
  // Debounced save — fires 800ms after any selection/setting change
  // ---------------------------------------------------------------------------

  const doComposite = useCallback(async () => {
    if (!selectedRefId || !selectedCutoutId) return;
    setSaving(true);
    try {
      const payload = {
        referenceAssetId: selectedRefId,
        cutoutAssetId: selectedCutoutId,
        position,
        size,
        bgMode,
        bgCrop: bgCrop ?? undefined,
      };
      let res = await fetch(`/api/compositions/${compositionId}/thumbnails/composite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      // Retry once on transient failure (e.g. HMR rebuild makes route temporarily unavailable)
      if (!res.ok && (res.status === 404 || res.status >= 500)) {
        await new Promise((r) => setTimeout(r, 2000));
        res = await fetch(`/api/compositions/${compositionId}/thumbnails/composite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
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
  }, [compositionId, selectedRefId, selectedCutoutId, position, size, bgMode, bgCrop]);

  // Trigger debounced save when selections change
  const isInitialMount = useRef(true);
  useEffect(() => {
    // Skip on initial mount to avoid unnecessary save
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (!selectedRefId || !selectedCutoutId) return;

    // Clear stale composite so the live preview shows while we generate the new one
    setCompositeUrl(null);

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(doComposite, 800);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [selectedRefId, selectedCutoutId, position, size, bgMode, bgCrop, doComposite]);

  // ---------------------------------------------------------------------------
  // Regenerate handler
  // ---------------------------------------------------------------------------

  const handleRegenerate = useCallback(async () => {
    setGenerating(true);
    setReferenceFrames([]);
    setCutouts([]);
    setAiBackgrounds([]);
    setCustomBackgrounds([]);
    setCompositeUrl(null);
    setSelectedRefId(null);
    setSelectedCutoutId(null);
    setBgMode('frame');
    setBgCrop(null);

    // When local files are available (client-side render), re-extract frames
    // and upload via generate-from-frames instead of using the server-side regenerate endpoint.
    const refFile = refFiles?.values().next().value as File | undefined;
    if (creatorFile || refFile) {
      try {
        const formData = new FormData();

        if (refFile) {
          const refFrames = await extractFrames(refFile, 20);
          const refTimestamps: number[] = [];
          for (const frame of refFrames) {
            formData.append(
              'referenceFrames',
              frame.blob,
              `ref_${frame.timestampS.toFixed(2)}.jpg`
            );
            refTimestamps.push(frame.timestampS);
          }
          formData.append('refTimestamps', JSON.stringify(refTimestamps));
        }

        if (creatorFile) {
          const creatorFrames = await extractFrames(creatorFile, 20);
          const creatorTimestamps: number[] = [];
          for (const frame of creatorFrames) {
            formData.append(
              'creatorFrames',
              frame.blob,
              `creator_${frame.timestampS.toFixed(2)}.jpg`
            );
            creatorTimestamps.push(frame.timestampS);
          }
          formData.append('creatorTimestamps', JSON.stringify(creatorTimestamps));
        }

        const res = await fetch(
          `/api/compositions/${compositionId}/thumbnails/generate-from-frames`,
          { method: 'POST', body: formData }
        );

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error || 'Failed to regenerate');
          setGenerating(false);
          return;
        }
        toast.success('Regenerating thumbnails...');
      } catch {
        toast.error('Failed to regenerate thumbnails');
        setGenerating(false);
      }
      return;
    }

    // Fallback: server-side regenerate (source videos on S3)
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
  }, [compositionId, setGenerating, creatorFile, refFiles]);

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

  // Core AI background generation — reused by mode select and regenerate
  const generateAiBackgrounds = useCallback(async () => {
    if (referenceFrames.length === 0) {
      toast.error('Generate reference frames first');
      return false;
    }
    setGeneratingAi(true);
    try {
      const res = await fetch(`/api/compositions/${compositionId}/thumbnails/ai-backgrounds`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to generate');
      }
      // Refresh assets and auto-select first AI background
      const updated = await fetch(`/api/compositions/${compositionId}/thumbnail-assets`);
      if (updated.ok) {
        const data = await updated.json();
        const aiBgs: ThumbnailAsset[] = data.aiBackgrounds || [];
        setAiBackgrounds(aiBgs);
        if (aiBgs.length > 0) {
          setSelectedRefId(aiBgs[0].id);
        }
      }
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate AI backgrounds');
      return false;
    } finally {
      setGeneratingAi(false);
    }
  }, [compositionId, referenceFrames]);

  // Switch to AI mode — generate on first use, reuse existing if available
  const handleAiModeSelect = useCallback(async () => {
    setBgMode('ai');
    if (aiBackgrounds.length > 0) {
      setSelectedRefId(aiBackgrounds[0].id);
      return;
    }
    const ok = await generateAiBackgrounds();
    if (!ok) setBgMode('frame');
  }, [aiBackgrounds, generateAiBackgrounds]);

  // Regenerate AI backgrounds (clear + re-generate)
  const handleRegenerateAi = useCallback(async () => {
    setAiBackgrounds([]);
    await generateAiBackgrounds();
  }, [generateAiBackgrounds]);

  const handleCustomBackgroundUpload = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        toast.error('Upload an image file');
        return;
      }

      setUploadingCustomBg(true);
      try {
        const formData = new FormData();
        formData.append('background', file);

        const res = await fetch(
          `/api/compositions/${compositionId}/thumbnails/custom-backgrounds`,
          {
            method: 'POST',
            body: formData,
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || 'Failed to upload background');
        }

        const asset = data.asset as ThumbnailAsset;
        setCustomBackgrounds((prev) => [asset, ...prev]);
        setBgMode('custom');
        setSelectedRefId(asset.id);
        setBgCrop(null);
        toast.success('Custom background uploaded');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to upload background');
      } finally {
        setUploadingCustomBg(false);
        if (customBgInputRef.current) customBgInputRef.current.value = '';
      }
    },
    [compositionId]
  );

  const isRendering = compositionStatus === 'rendering';
  const hasAssets = referenceFrames.length > 0 || cutouts.length > 0;
  const activeBackgrounds =
    bgMode === 'ai' ? aiBackgrounds : bgMode === 'custom' ? customBackgrounds : referenceFrames;
  const selectedRef =
    activeBackgrounds.find((r) => r.id === selectedRefId) ??
    customBackgrounds.find((r) => r.id === selectedRefId) ??
    aiBackgrounds.find((r) => r.id === selectedRefId) ??
    referenceFrames.find((r) => r.id === selectedRefId);
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
            {selectedRef && !bgCrop && (
              <img
                src={selectedRef.s3Url}
                alt="Reference frame background"
                className="absolute inset-0 h-full w-full object-cover"
                draggable={false}
              />
            )}
            {selectedRef && bgCrop && (
              <CroppedBgPreview imageUrl={selectedRef.s3Url} crop={bgCrop} />
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
            {/* Background mode toggle */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Background</span>
              <div className="flex items-center gap-1.5">
                <div className="flex rounded-md border">
                  <button
                    className={cn(
                      'px-2.5 py-1 text-xs transition-colors',
                      bgMode === 'frame' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                    )}
                    onClick={() => {
                      setBgMode('frame');
                      // Auto-select best reference frame
                      if (referenceFrames.length > 0) {
                        const best = referenceFrames.reduce((a, b) =>
                          (b.visionScore ?? 0) > (a.visionScore ?? 0) ? b : a
                        );
                        setSelectedRefId(best.id);
                      }
                    }}
                  >
                    Video Frame
                  </button>
                  <button
                    className={cn(
                      'flex items-center gap-1 px-2.5 py-1 text-xs transition-colors',
                      bgMode === 'custom' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                    )}
                    onClick={() => {
                      if (customBackgrounds.length > 0) {
                        setBgMode('custom');
                        setBgCrop(null);
                        setSelectedRefId(customBackgrounds[0].id);
                      } else {
                        customBgInputRef.current?.click();
                      }
                    }}
                  >
                    <ImagePlus className="h-3 w-3" />
                    Custom
                  </button>
                  <button
                    className={cn(
                      'flex items-center gap-1 px-2.5 py-1 text-xs transition-colors',
                      bgMode === 'ai' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                    )}
                    onClick={handleAiModeSelect}
                    disabled={generatingAi}
                  >
                    {generatingAi ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Wand2 className="h-3 w-3" />
                    )}
                    AI Generated
                  </button>
                </div>
                {bgMode === 'ai' && aiBackgrounds.length > 0 && (
                  <button
                    className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                    onClick={handleRegenerateAi}
                    disabled={generatingAi}
                    title="Regenerate AI backgrounds"
                  >
                    {generatingAi ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Crop background button */}
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setCropModalOpen(true)}
                disabled={!selectedRef || bgMode === 'ai'}
              >
                <Crop className="h-3 w-3" />
                Crop BG
              </Button>
              {bgCrop && bgMode !== 'ai' && (
                <span className="rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                  Cropped
                </span>
              )}
            </div>

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

          {/* Background grid — conditional on mode */}
          {bgMode === 'frame' && referenceFrames.length > 0 && (
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

          {bgMode === 'ai' && (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">AI Backgrounds</span>
              {generatingAi ? (
                <AssetSkeletonGrid count={4} />
              ) : aiBackgrounds.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {aiBackgrounds.map((asset) => (
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
                        alt={`AI background — ${asset.styleVariant}`}
                        className="h-16 w-24 object-cover"
                        loading="lazy"
                      />
                      {selectedRefId === asset.id && (
                        <div className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-white">
                          <Check className="h-2.5 w-2.5" />
                        </div>
                      )}
                      {asset.styleVariant && (
                        <div className="absolute bottom-0.5 left-0.5 rounded bg-violet-600/80 px-1 py-px text-[9px] font-medium capitalize text-white">
                          {asset.styleVariant}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  No AI backgrounds yet. Click &quot;AI Generated&quot; to create them.
                </p>
              )}
            </div>
          )}

          {bgMode === 'custom' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Custom Backgrounds
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => customBgInputRef.current?.click()}
                  disabled={uploadingCustomBg}
                >
                  {uploadingCustomBg ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ImagePlus className="h-3 w-3" />
                  )}
                  Upload
                </Button>
                <input
                  ref={customBgInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => handleCustomBackgroundUpload(event.target.files?.[0])}
                />
              </div>
              {uploadingCustomBg ? (
                <AssetSkeletonGrid count={1} />
              ) : customBackgrounds.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {customBackgrounds.map((asset) => (
                    <button
                      key={asset.id}
                      onClick={() => {
                        setSelectedRefId(asset.id);
                        setBgCrop(null);
                      }}
                      className={cn(
                        'group relative flex-shrink-0 overflow-hidden rounded-md border-2 transition-all',
                        selectedRefId === asset.id
                          ? 'border-blue-500 ring-2 ring-blue-500/30'
                          : 'border-border hover:border-blue-300 dark:hover:border-blue-600'
                      )}
                    >
                      <img
                        src={asset.s3Url}
                        alt="Custom background"
                        className="h-16 w-24 object-cover"
                        loading="lazy"
                      />
                      {selectedRefId === asset.id && (
                        <div className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-white">
                          <Check className="h-2.5 w-2.5" />
                        </div>
                      )}
                      <div className="absolute bottom-0.5 left-0.5 rounded bg-emerald-600/80 px-1 py-px text-[9px] font-medium text-white">
                        Custom
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  Upload a post image, screenshot, or designed background to place behind the
                  creator cutout.
                </p>
              )}
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
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={async () => {
                  try {
                    const res = await fetch(compositeUrl);
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'thumbnail.png';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                  } catch {
                    toast.error('Failed to download thumbnail');
                  }
                }}
              >
                <Download className="h-3 w-3" />
                Download Thumbnail
              </Button>
            </div>
          )}
          {/* Crop modal */}
          {selectedRef && bgMode !== 'ai' && (
            <ThumbnailCropModal
              open={cropModalOpen}
              onOpenChange={setCropModalOpen}
              imageUrl={selectedRef.s3Url}
              currentCrop={bgCrop}
              onSave={(newCrop) => {
                setBgCrop(newCrop);
                setCropModalOpen(false);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
