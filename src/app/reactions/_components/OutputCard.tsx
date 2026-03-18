'use client';

import { Badge } from '@/components/ui/badge';

interface OutputCardProps {
  output: {
    id: string;
    layout: string;
    status: string;
    s3Url?: string | null;
    renderError?: string | null;
    durationMs?: number | null;
    fileSizeBytes?: string | null;
  };
}

export function OutputCard({ output }: OutputCardProps) {
  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium capitalize">{output.layout}</span>
        <Badge
          className={
            output.status === 'completed'
              ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
              : output.status === 'failed'
                ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                : ''
          }
          variant={
            output.status === 'completed' || output.status === 'failed' ? 'default' : 'outline'
          }
        >
          {output.status}
        </Badge>
      </div>

      {output.status === 'completed' && output.s3Url && (
        <>
          <video src={output.s3Url} controls className="w-full rounded-md" />
          <a
            href={output.s3Url}
            download
            className="inline-block text-sm text-blue-500 hover:underline"
          >
            Download {output.layout}
          </a>
        </>
      )}

      {output.renderError && (
        <p className="text-xs text-destructive break-words">{output.renderError}</p>
      )}

      {output.durationMs && (
        <p className="text-xs text-muted-foreground">
          Rendered in {(output.durationMs / 1000).toFixed(1)}s
        </p>
      )}
    </div>
  );
}
