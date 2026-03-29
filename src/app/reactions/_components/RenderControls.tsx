'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { VideoCard } from '@/components/ui/video-card';
import { Loader2, Download, Share2, Sparkles, Monitor, X } from 'lucide-react';
import { LayoutPreview } from './LayoutPreview';
import { PublishModal } from '@/components/PublishModal';
import {
  supportsClientRender,
  renderCompositionClient,
  type ClientRenderOptions,
  type RenderProgress,
  type ClientTrackInfo,
} from '@/lib/client-render';
import toast from 'react-hot-toast';

interface Output {
  id: string;
  layout: string;
  status: string;
  s3Url?: string | null;
  renderError?: string | null;
  durationMs?: number | null;
  transcript?: string | null;
}

interface CompositionData {
  id: string;
  audioMode: string;
  creatorVolume: number;
  referenceVolume: number;
  creatorDurationS?: number | null;
  creatorWidth?: number | null;
  creatorHeight?: number | null;
  creatorTrimStartS: number;
  creatorTrimEndS?: number | null;
  tracks: Array<{
    id: string;
    durationS: number;
    width?: number | null;
    height?: number | null;
    startAtS: number;
    trimStartS: number;
    trimEndS: number | null;
    sortOrder: number;
    hasAudio: boolean;
  }>;
}

interface RenderControlsProps {
  compositionId: string;
  compositionStatus: string;
  outputs: Output[];
  hasCreator: boolean;
  hasTracks: boolean;
  hasPortraitRef: boolean;
  hasLandscapeRef: boolean;
  autoLayouts: ('mobile' | 'landscape')[];
  onStatusChange: (status: string, outputs: Output[]) => void;
  compositionTitle?: string;
  trackLabels?: string[];
  uploadsInProgress?: boolean;
  uploadProgress?: number;
  renderRequested?: boolean;
  onRenderRequested?: () => void;
  onCancelRenderRequest?: () => void;
  serverRenderReady?: boolean;
  // Client-side render props
  creatorFile?: File | null;
  refFiles?: Map<string, File>;
  composition?: CompositionData | null;
  /** Externally managed blob state for client-rendered outputs */
  clientOutputBlobs: Map<string, Blob>;
  clientOutputUrls: Map<string, string>;
  onBlobReady: (layout: string, blob: Blob, url: string) => void;
}

const LAYOUT_LABELS: Record<string, string> = {
  mobile: '9:16 Portrait',
  landscape: '16:9 Landscape',
};

export function RenderControls({
  compositionId,
  compositionStatus,
  outputs,
  hasCreator,
  hasTracks,
  hasPortraitRef,
  hasLandscapeRef,
  autoLayouts,
  onStatusChange,
  compositionTitle,
  trackLabels,
  uploadsInProgress,
  uploadProgress,
  renderRequested,
  onRenderRequested,
  onCancelRenderRequest,
  serverRenderReady,
  creatorFile,
  refFiles,
  composition,
  clientOutputBlobs,
  clientOutputUrls,
  onBlobReady,
}: RenderControlsProps) {
  const [rendering, setRendering] = useState(compositionStatus === 'rendering');
  const [publishTarget, setPublishTarget] = useState<{
    s3Url: string;
    layout: string;
    transcript?: string | null;
  } | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const [preGenDescriptions, setPreGenDescriptions] = useState<Record<string, string>>({});
  const [generatingDesc, setGeneratingDesc] = useState<Set<string>>(new Set());
  const generatedForRef = useRef<Set<string>>(new Set());

  // Client-side render state — per-layout progress for parallel rendering
  const [clientRenderProgress, setClientRenderProgress] = useState<Map<string, RenderProgress>>(
    new Map()
  );
  const [uploadingOutput, setUploadingOutput] = useState<string | null>(null);
  const [uploadOutputProgress, setUploadOutputProgress] = useState(0);
  const canClientRender = supportsClientRender() && !!creatorFile;
  const clientRenderingRef = useRef(false);

  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const generateDescription = useCallback(
    async (layout: string, transcript?: string | null) => {
      if (generatedForRef.current.has(layout)) return;
      generatedForRef.current.add(layout);
      setGeneratingDesc((prev) => new Set(prev).add(layout));
      try {
        const res = await fetch('/api/social-posts/generate-description', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: compositionTitle,
            trackLabels,
            layouts: [layout],
            transcript: transcript || undefined,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setPreGenDescriptions((prev) => ({ ...prev, [layout]: data.description }));
        }
      } catch {
        // Non-fatal
      } finally {
        setGeneratingDesc((prev) => {
          const next = new Set(prev);
          next.delete(layout);
          return next;
        });
      }
    },
    [compositionTitle, trackLabels]
  );

  useEffect(() => {
    // Only poll the server for server-side renders.
    // Client-side renders manage state locally — polling would overwrite it.
    if (!rendering || clientRenderingRef.current) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/compositions/${compositionId}/render/status`);
        if (!res.ok) return;
        const data = await res.json();
        const isStillRendering =
          data.status === 'rendering' ||
          data.outputs?.some((o: Output) => o.status === 'rendering' || o.status === 'pending');
        onStatusChangeRef.current(data.status, data.outputs);

        for (const output of data.outputs ?? []) {
          if (output.status === 'completed' && output.s3Url) {
            generateDescription(output.layout, output.transcript);
          }
        }

        if (!isStillRendering) {
          setRendering(false);
          const allDone = data.outputs?.every((o: Output) => o.status === 'completed');
          if (allDone) {
            toast.success('Render complete!');
          } else {
            const failed = data.outputs?.filter((o: Output) => o.status === 'failed');
            if (failed?.length) {
              toast.error(`Render failed for ${failed.map((f: Output) => f.layout).join(', ')}`);
            }
          }
        }
      } catch {
        // Ignore poll errors
      }
    };

    pollRef.current = setInterval(poll, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [rendering, compositionId, generateDescription]);

  useEffect(() => {
    if (compositionStatus === 'rendering') {
      setRendering(true);
    }
  }, [compositionStatus]);

  useEffect(() => {
    for (const output of outputs) {
      if (output.status === 'completed' && output.s3Url) {
        generateDescription(output.layout, output.transcript);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = async () => {
    if (!confirm('Cancel the current render?')) return;
    try {
      const res = await fetch(`/api/compositions/${compositionId}/render/cancel`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to cancel render');
        return;
      }
      setRendering(false);
      toast.success('Render cancelled');
      const statusRes = await fetch(`/api/compositions/${compositionId}/render/status`);
      if (statusRes.ok) {
        const data = await statusRes.json();
        onStatusChangeRef.current(data.status, data.outputs);
      }
    } catch {
      toast.error('Failed to cancel render');
    }
  };

  /** Build ClientRenderOptions from composition state */
  const buildClientRenderOptions = useCallback(
    (layout: 'mobile' | 'landscape'): ClientRenderOptions | null => {
      if (!creatorFile || !composition) return null;

      const tracks: ClientTrackInfo[] = [];

      for (const track of composition.tracks) {
        const file = refFiles?.get(track.id);
        if (!file) continue;

        tracks.push({
          file,
          startAtS: track.startAtS,
          trimStartS: track.trimStartS,
          trimEndS: track.trimEndS,
          durationS: track.durationS,
          width: track.width ?? 1920,
          height: track.height ?? 1080,
          hasAudio: track.hasAudio,
          sortOrder: track.sortOrder,
        });
      }

      return {
        layout,
        creatorFile,
        creatorDurationS: composition.creatorDurationS ?? 0,
        creatorTrimStartS: composition.creatorTrimStartS,
        creatorTrimEndS: composition.creatorTrimEndS ?? null,
        creatorWidth: composition.creatorWidth ?? 1920,
        creatorHeight: composition.creatorHeight ?? 1080,
        tracks,
        audioMode: composition.audioMode as 'creator' | 'reference' | 'both',
        creatorVolume: composition.creatorVolume,
        referenceVolume: composition.referenceVolume,
      };
    },
    [creatorFile, refFiles, composition]
  );

  /** Client-side render: render all layouts in parallel */
  const handleClientRender = useCallback(async () => {
    if (!creatorFile || !composition) return;

    clientRenderingRef.current = true;
    setRendering(true);
    setClientRenderProgress(new Map());

    // Create placeholder outputs — show "rendering" cards immediately
    const outputsByLayout: Record<string, Output> = {};
    for (const layout of autoLayouts) {
      outputsByLayout[layout] = {
        id: `client_${layout}`,
        layout,
        status: 'rendering',
        s3Url: null,
        renderError: null,
        durationMs: null,
      };
    }
    onStatusChange('rendering', Object.values(outputsByLayout));

    // Render all layouts in parallel
    await Promise.all(
      autoLayouts.map(async (layout) => {
        const opts = buildClientRenderOptions(layout);
        if (!opts) {
          outputsByLayout[layout] = {
            ...outputsByLayout[layout],
            status: 'failed',
            renderError: 'Missing files for client render',
          };
          onStatusChange('rendering', Object.values(outputsByLayout));
          return;
        }

        try {
          const startMs = Date.now();
          const blob = await renderCompositionClient(opts, (progress) => {
            setClientRenderProgress((prev) => new Map(prev).set(layout, progress));
          });
          const durationMs = Date.now() - startMs;

          const blobUrl = URL.createObjectURL(blob);
          onBlobReady(layout, blob, blobUrl);

          outputsByLayout[layout] = {
            ...outputsByLayout[layout],
            status: 'completed',
            s3Url: blobUrl,
            durationMs,
          };
          onStatusChange('rendering', Object.values(outputsByLayout));
          toast.success(`${layout === 'mobile' ? '9:16' : '16:9'} render complete!`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[client-render] ${layout} failed:`, err);
          outputsByLayout[layout] = {
            ...outputsByLayout[layout],
            status: 'failed',
            renderError: message,
          };
          onStatusChange('rendering', Object.values(outputsByLayout));
          toast.error(`${layout === 'mobile' ? '9:16' : '16:9'} render failed`);
        }
      })
    );

    clientRenderingRef.current = false;
    setRendering(false);
    setClientRenderProgress(new Map());

    const finalOutputs = Object.values(outputsByLayout);
    const allSucceeded = finalOutputs.every((o) => o.status === 'completed');
    onStatusChange(allSucceeded ? 'completed' : 'failed', finalOutputs);
  }, [
    creatorFile,
    composition,
    autoLayouts,
    onStatusChange,
    buildClientRenderOptions,
    onBlobReady,
  ]);

  /** Upload a client-rendered blob to S3 and save to the composition */
  const handleUploadOutput = useCallback(
    async (layout: string) => {
      const blob = clientOutputBlobs.get(layout);
      if (!blob) return;

      setUploadingOutput(layout);
      setUploadOutputProgress(0);

      try {
        // 1. Initiate multipart upload
        const filename = `${compositionId}_${layout}.mp4`;
        const initRes = await fetch('/api/uploads/multipart/initiate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename,
            contentType: 'video/mp4',
            keyPrefix: `compositions/${compositionId}/renders`,
          }),
        });
        if (!initRes.ok) throw new Error('Failed to initiate upload');
        const { uploadId, key } = await initRes.json();

        // 2. Upload in chunks
        const CHUNK_SIZE = 64 * 1024 * 1024;
        const totalParts = Math.ceil(blob.size / CHUNK_SIZE);
        const partNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);

        const batchRes = await fetch('/api/uploads/multipart/batch-part-urls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uploadId, key, partNumbers }),
        });
        if (!batchRes.ok) throw new Error('Failed to get upload URLs');
        const { urls: batchUrls } = await batchRes.json();

        const etags: { PartNumber: number; ETag: string }[] = [];
        for (const { partNumber, url } of batchUrls) {
          const start = (partNumber - 1) * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, blob.size);
          const chunk = blob.slice(start, end);

          const uploadRes = await fetch(url, { method: 'PUT', body: chunk });
          if (!uploadRes.ok) throw new Error(`Part ${partNumber} upload failed`);

          etags.push({
            PartNumber: partNumber,
            ETag: uploadRes.headers.get('ETag') || '',
          });
          setUploadOutputProgress(Math.round((partNumber / totalParts) * 100));
        }

        // 3. Complete multipart
        const completeRes = await fetch('/api/uploads/multipart/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, uploadId, parts: etags }),
        });
        if (!completeRes.ok) throw new Error('Failed to complete upload');
        const { s3Url } = await completeRes.json();

        // 4. Save to composition via API
        await fetch(`/api/compositions/${compositionId}/render/client-complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ layout, s3Key: key, s3Url }),
        });

        toast.success(`${layout === 'mobile' ? '9:16' : '16:9'} uploaded to cloud`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[upload-output]', message);
        toast.error('Failed to upload render');
      } finally {
        setUploadingOutput(null);
        setUploadOutputProgress(0);
      }
    },
    [clientOutputBlobs, compositionId]
  );

  /** Server-side render: POST to API and begin polling */
  const handleServerRender = useCallback(async () => {
    setRendering(true);

    const resetOutputs = outputs.map((o) => ({
      ...o,
      status: 'pending',
      s3Url: null,
      renderError: null,
      durationMs: null,
    }));
    onStatusChange('rendering', resetOutputs);

    try {
      const res = await fetch(`/api/compositions/${compositionId}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layouts: autoLayouts }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to start render');
        setRendering(false);
        onStatusChange(compositionStatus, outputs);
        return;
      }

      toast.success('Render started!');
    } catch {
      toast.error('Failed to start render');
      setRendering(false);
      onStatusChange(compositionStatus, outputs);
    }
  }, [compositionId, autoLayouts, outputs, onStatusChange, compositionStatus]);

  const handleRender = async () => {
    if (!hasCreator || !hasTracks) return;

    if (uploadsInProgress) {
      if (!canClientRender) {
        onRenderRequested?.();
        toast.success('Render queued — will start when uploads finish');
      } else {
        toast(`Finishing upload… ${uploadProgress ?? 0}%`, { icon: '⏳' });
      }
      return;
    }

    if (canClientRender) {
      handleClientRender();
      return;
    }

    handleServerRender();
  };

  // Auto-trigger server render when uploads finish and render was queued
  useEffect(() => {
    if (!renderRequested || !serverRenderReady || rendering) return;
    onCancelRenderRequest?.();
    handleServerRender();
  }, [renderRequested, serverRenderReady, rendering, onCancelRenderRequest, handleServerRender]);

  const statusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <Badge className="bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300">
            Completed
          </Badge>
        );
      case 'rendering':
        return (
          <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
            Rendering
          </Badge>
        );
      case 'failed':
        return (
          <Badge className="bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
            Failed
          </Badge>
        );
      default:
        return <Badge variant="outline">Pending</Badge>;
    }
  };

  const detectionSummary = !hasTracks
    ? 'Upload reference clips to render'
    : canClientRender
      ? 'Client-side render (no upload needed)'
      : 'Rendering both 9:16 and 16:9 formats';

  // Aggregate progress across all layouts for the button label
  const aggregatePercent =
    clientRenderProgress.size > 0
      ? Math.round(
          Array.from(clientRenderProgress.values()).reduce((sum, p) => sum + p.percent, 0) /
            autoLayouts.length
        )
      : 0;

  const renderButtonLabel = rendering
    ? aggregatePercent > 0
      ? `Rendering... ${aggregatePercent}%`
      : 'Rendering...'
    : renderRequested && uploadsInProgress
      ? `Render queued — uploading ${uploadProgress ?? 0}%`
      : uploadsInProgress
        ? `Uploading… ${uploadProgress ?? 0}%`
        : outputs.some((o) => o.s3Url) || clientOutputUrls.size > 0
          ? 'Re-render'
          : 'Render';

  return (
    <div className="space-y-4">
      {/* Render button */}
      <div className="flex items-center gap-2">
        {rendering && !canClientRender && (
          <Button variant="outline" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
        )}
        {renderRequested && uploadsInProgress && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              onCancelRenderRequest?.();
              toast('Render cancelled');
            }}
            title="Cancel queued render"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
        <Button
          onClick={handleRender}
          disabled={rendering || !hasCreator || !hasTracks || renderRequested}
        >
          {(rendering || (renderRequested && uploadsInProgress)) && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          {renderButtonLabel}
        </Button>
        {canClientRender && (
          <Badge variant="secondary" className="gap-1 text-[10px] h-5">
            <Monitor className="h-3 w-3" />
            Local
          </Badge>
        )}
      </div>

      {/* Client render progress bar */}
      {rendering && clientRenderProgress.size > 0 && (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-blue-500 transition-[width] duration-300"
              style={{ width: `${aggregatePercent}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            {Array.from(clientRenderProgress.entries())
              .map(([l, p]) => `${l === 'mobile' ? '9:16' : '16:9'}: ${p.percent}%`)
              .join(' · ')}
          </p>
        </div>
      )}

      {/* Output cards — always show placeholders for expected layouts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {autoLayouts.map((layout) => {
          const output = outputs.find((o) => o.layout === layout);
          const isCompleted = output?.status === 'completed' && output.s3Url;
          const isActive = output?.status === 'rendering' || output?.status === 'pending';
          const isFailed = output?.status === 'failed';

          return (
            <VideoCard
              key={layout}
              size="md"
              src={isCompleted ? output.s3Url! : undefined}
              controls={!!isCompleted}
              label={LAYOUT_LABELS[layout] || layout}
              badge={output ? statusBadge(output.status) : undefined}
              sublabel={
                <>
                  {isFailed && output?.renderError && (
                    <p className="text-xs text-destructive line-clamp-2">{output.renderError}</p>
                  )}
                  {isCompleted && (
                    <div className="mt-1 flex items-center justify-between">
                      {output.durationMs ? (
                        <span className="text-xs text-muted-foreground">
                          Rendered in {(output.durationMs / 1000).toFixed(1)}s
                        </span>
                      ) : (
                        <span />
                      )}
                      <div className="flex gap-1 flex-wrap">
                        {/* Upload to cloud button (only for local renders) */}
                        {clientOutputBlobs.has(layout) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 text-xs"
                            onClick={() => handleUploadOutput(layout)}
                            disabled={uploadingOutput === layout}
                          >
                            {uploadingOutput === layout ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                {uploadOutputProgress}%
                              </>
                            ) : (
                              <>
                                <Share2 className="h-3 w-3" />
                                Upload
                              </>
                            )}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 text-xs"
                          onClick={() =>
                            setPublishTarget({
                              s3Url: output.s3Url!,
                              layout: output.layout,
                              transcript: output.transcript,
                            })
                          }
                        >
                          {generatingDesc.has(layout) ? (
                            <Sparkles className="h-3 w-3 animate-pulse text-amber-500" />
                          ) : preGenDescriptions[layout] ? (
                            <Sparkles className="h-3 w-3 text-green-500" />
                          ) : (
                            <Share2 className="h-3 w-3" />
                          )}
                          Share
                        </Button>
                        <Button variant="outline" size="sm" asChild className="h-7 gap-1 text-xs">
                          <a href={output.s3Url!} download>
                            <Download className="h-3 w-3" />
                            Download
                          </a>
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              }
              className="max-w-none"
            >
              {isActive ? (
                <div className="flex h-full flex-col items-center justify-center gap-1.5">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  {clientRenderProgress.has(layout) && (
                    <>
                      <span className="text-sm font-medium text-muted-foreground tabular-nums">
                        {clientRenderProgress.get(layout)!.percent}%
                      </span>
                      <span className="text-[10px] text-muted-foreground/70 max-w-[200px] text-center truncate">
                        {clientRenderProgress.get(layout)!.message}
                      </span>
                    </>
                  )}
                </div>
              ) : isFailed ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {output?.renderError ? 'Render failed' : 'No output'}
                </div>
              ) : !isCompleted ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Ready to render
                </div>
              ) : null}
            </VideoCard>
          );
        })}
      </div>

      <PublishModal
        open={!!publishTarget}
        onOpenChange={(open) => {
          if (!open) setPublishTarget(null);
        }}
        mediaUrl={publishTarget?.s3Url}
        mediaLabel={publishTarget?.layout}
        generationContext={{
          title: compositionTitle,
          trackLabels,
          layouts: publishTarget ? [publishTarget.layout] : [],
          transcript: publishTarget?.transcript || undefined,
        }}
        preGeneratedContent={publishTarget ? preGenDescriptions[publishTarget.layout] : undefined}
      />
    </div>
  );
}
