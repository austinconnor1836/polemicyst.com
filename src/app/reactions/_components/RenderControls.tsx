'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Download } from 'lucide-react';
import { LayoutPreview } from './LayoutPreview';
import toast from 'react-hot-toast';

interface Output {
  id: string;
  layout: string;
  status: string;
  s3Url?: string | null;
  renderError?: string | null;
  durationMs?: number | null;
}

interface RenderControlsProps {
  compositionId: string;
  compositionStatus: string;
  outputs: Output[];
  hasCreator: boolean;
  hasTracks: boolean;
  hasPortraitRef: boolean;
  hasLandscapeRef: boolean;
  onStatusChange: (status: string, outputs: Output[]) => void;
}

export function RenderControls({
  compositionId,
  compositionStatus,
  outputs,
  hasCreator,
  hasTracks,
  hasPortraitRef,
  hasLandscapeRef,
  onStatusChange,
}: RenderControlsProps) {
  const [selectedLayouts, setSelectedLayouts] = useState<Set<string>>(
    new Set(['mobile', 'landscape'])
  );
  const [rendering, setRendering] = useState(compositionStatus === 'rendering');
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const toggleLayout = (layout: string) => {
    setSelectedLayouts((prev) => {
      const next = new Set(prev);
      if (next.has(layout)) {
        if (next.size > 1) next.delete(layout);
      } else {
        next.add(layout);
      }
      return next;
    });
  };

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/compositions/${compositionId}/render/status`);
      if (!res.ok) return;
      const data = await res.json();
      const isStillRendering =
        data.status === 'rendering' ||
        data.outputs?.some((o: Output) => o.status === 'rendering' || o.status === 'pending');
      onStatusChange(data.status, data.outputs);
      if (!isStillRendering) {
        setRendering(false);
        if (pollRef.current) clearInterval(pollRef.current);
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
  }, [compositionId, onStatusChange]);

  useEffect(() => {
    if (rendering) {
      pollRef.current = setInterval(pollStatus, 3000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [rendering, pollStatus]);

  // Start polling if we loaded a rendering composition
  useEffect(() => {
    if (compositionStatus === 'rendering') {
      setRendering(true);
    }
  }, [compositionStatus]);

  const handleRender = async () => {
    if (!hasCreator || !hasTracks) return;

    setRendering(true);
    try {
      const res = await fetch(`/api/compositions/${compositionId}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layouts: Array.from(selectedLayouts) }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to start render');
        setRendering(false);
        return;
      }

      toast.success('Render started!');
    } catch (err) {
      toast.error('Failed to start render');
      setRendering(false);
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex gap-3">
          {(['mobile', 'landscape'] as const).map((layout) => (
            <button
              key={layout}
              type="button"
              onClick={() => toggleLayout(layout)}
              className={`rounded-lg border p-2 transition-colors ${
                selectedLayouts.has(layout)
                  ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950'
                  : 'border-border opacity-50'
              }`}
            >
              <LayoutPreview
                layout={layout}
                hasReference={hasTracks}
                hasPortraitRef={hasPortraitRef}
                hasLandscapeRef={hasLandscapeRef}
              />
            </button>
          ))}
        </div>

        <Button
          onClick={handleRender}
          disabled={rendering || !hasCreator || !hasTracks}
          className="ml-auto"
        >
          {rendering && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {rendering ? 'Rendering...' : 'Render'}
        </Button>
      </div>

      {/* Output cards */}
      {outputs.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {outputs.map((output) => (
            <Card key={output.id} className="group overflow-hidden">
              {/* Video / status area */}
              <div className="relative aspect-video bg-black/5 dark:bg-black/20">
                {output.status === 'completed' && output.s3Url ? (
                  <video
                    src={output.s3Url}
                    controls
                    preload="metadata"
                    className="h-full w-full object-contain bg-black"
                  />
                ) : output.status === 'rendering' || output.status === 'pending' ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    {output.renderError ? 'Render failed' : 'No output'}
                  </div>
                )}
              </div>

              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium capitalize">{output.layout}</span>
                  {statusBadge(output.status)}
                </div>

                {output.renderError && (
                  <p className="mt-1 text-xs text-destructive line-clamp-2">{output.renderError}</p>
                )}

                <div className="mt-2 flex items-center justify-between">
                  {output.durationMs ? (
                    <span className="text-xs text-muted-foreground">
                      Rendered in {(output.durationMs / 1000).toFixed(1)}s
                    </span>
                  ) : (
                    <span />
                  )}

                  {output.status === 'completed' && output.s3Url && (
                    <Button variant="outline" size="sm" asChild className="h-7 gap-1 text-xs">
                      <a href={output.s3Url} download>
                        <Download className="h-3 w-3" />
                        Download
                      </a>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
