'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { VideoCard } from '@/components/ui/video-card';
import { Loader2, Download, Share2, Sparkles } from 'lucide-react';
import { LayoutPreview } from './LayoutPreview';
import { PublishModal } from '@/components/PublishModal';
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
    if (!rendering) return;

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

  const handleRender = async () => {
    if (!hasCreator || !hasTracks) return;

    if (uploadsInProgress) {
      toast(`Finishing upload… ${uploadProgress ?? 0}%`, { icon: '⏳' });
      return;
    }

    setRendering(true);

    // Optimistically reset outputs to pending so spinners show immediately
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
        // Restore original outputs on failure
        onStatusChange(compositionStatus, outputs);
        return;
      }

      toast.success('Render started!');
    } catch (err) {
      toast.error('Failed to start render');
      setRendering(false);
      onStatusChange(compositionStatus, outputs);
    }
  };

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
    : 'Rendering both 9:16 and 16:9 formats';

  return (
    <div className="space-y-4">
      {/* Auto-detected layout previews */}
      <div className="flex items-center gap-4">
        <div className="flex gap-3">
          {autoLayouts.map((layout) => (
            <div
              key={layout}
              className="rounded-lg border border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950 p-2"
            >
              <LayoutPreview
                layout={layout}
                hasReference={hasTracks}
                hasPortraitRef={hasPortraitRef}
                hasLandscapeRef={hasLandscapeRef}
              />
            </div>
          ))}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground">{detectionSummary}</p>
        </div>

        <div className="ml-auto flex gap-2 shrink-0">
          {rendering && (
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          )}
          <Button onClick={handleRender} disabled={rendering || !hasCreator || !hasTracks}>
            {rendering && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {rendering
              ? 'Rendering...'
              : uploadsInProgress
                ? `Uploading… ${uploadProgress ?? 0}%`
                : outputs.some((o) => o.s3Url)
                  ? 'Re-render'
                  : 'Render'}
          </Button>
        </div>
      </div>

      {/* Output cards */}
      {outputs.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {outputs.map((output) => (
            <VideoCard
              key={output.id}
              size="md"
              src={output.status === 'completed' && output.s3Url ? output.s3Url : undefined}
              controls={output.status === 'completed' && !!output.s3Url}
              label={LAYOUT_LABELS[output.layout] || output.layout}
              badge={statusBadge(output.status)}
              sublabel={
                <>
                  {output.renderError && (
                    <p className="text-xs text-destructive line-clamp-2">{output.renderError}</p>
                  )}
                  <div className="mt-1 flex items-center justify-between">
                    {output.durationMs ? (
                      <span className="text-xs text-muted-foreground">
                        Rendered in {(output.durationMs / 1000).toFixed(1)}s
                      </span>
                    ) : (
                      <span />
                    )}
                    {output.status === 'completed' && output.s3Url && (
                      <div className="flex gap-1">
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
                          {generatingDesc.has(output.layout) ? (
                            <Sparkles className="h-3 w-3 animate-pulse text-amber-500" />
                          ) : preGenDescriptions[output.layout] ? (
                            <Sparkles className="h-3 w-3 text-green-500" />
                          ) : (
                            <Share2 className="h-3 w-3" />
                          )}
                          Share
                        </Button>
                        <Button variant="outline" size="sm" asChild className="h-7 gap-1 text-xs">
                          <a href={output.s3Url} download>
                            <Download className="h-3 w-3" />
                            Download
                          </a>
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              }
              className="max-w-none"
            >
              {output.status === 'rendering' || output.status === 'pending' ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : output.status !== 'completed' ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {output.renderError ? 'Render failed' : 'No output'}
                </div>
              ) : null}
            </VideoCard>
          ))}
        </div>
      )}

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
