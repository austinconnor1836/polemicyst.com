'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {outputs.map((output) => (
            <div key={output.id} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium capitalize">{output.layout}</span>
                {statusBadge(output.status)}
              </div>

              {output.status === 'completed' && output.s3Url && (
                <video src={output.s3Url} controls className="w-full rounded-md" />
              )}

              {output.status === 'completed' && output.s3Url && (
                <a href={output.s3Url} download className="text-xs text-blue-500 hover:underline">
                  Download
                </a>
              )}

              {output.renderError && (
                <p className="text-xs text-destructive">{output.renderError}</p>
              )}

              {output.durationMs && (
                <p className="text-xs text-muted-foreground">
                  Rendered in {(output.durationMs / 1000).toFixed(1)}s
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
