'use client';

import { useState, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Upload, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface VideoUploaderProps {
  label: string;
  s3Key?: string | null;
  s3Url?: string | null;
  onUploaded: (data: { s3Key: string; s3Url: string; filename: string }) => void;
  onRemove?: () => void;
  className?: string;
  keyPrefix?: string;
}

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
const UPLOAD_CONCURRENCY = 4;

export function VideoUploader({
  label,
  s3Key,
  s3Url,
  onUploaded,
  onRemove,
  className,
  keyPrefix,
}: VideoUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(
    async (file: File) => {
      setUploading(true);
      setProgress(0);
      setError(null);

      try {
        // 1. Initiate multipart upload
        const initRes = await fetch('/api/uploads/multipart/initiate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type || 'video/mp4',
            ...(keyPrefix ? { keyPrefix } : {}),
          }),
        });
        if (!initRes.ok) {
          let detail = '';
          try {
            const body = await initRes.json();
            detail = body.detail || body.error || '';
          } catch {
            /* ignore parse errors */
          }
          throw new Error(`Failed to initiate upload${detail ? `: ${detail}` : ''}`);
        }
        const { uploadId, key } = await initRes.json();

        // 2. Upload parts with concurrency
        const totalParts = Math.ceil(file.size / CHUNK_SIZE);
        let completedParts = 0;

        const uploadPart = async (partNumber: number) => {
          const start = (partNumber - 1) * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunk = file.slice(start, end);

          const urlRes = await fetch('/api/uploads/multipart/part-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, uploadId, partNumber }),
          });
          if (!urlRes.ok) throw new Error(`Failed to get presigned URL for part ${partNumber}`);
          const { url } = await urlRes.json();

          const uploadRes = await fetch(url, { method: 'PUT', body: chunk });
          if (!uploadRes.ok) throw new Error(`Failed to upload part ${partNumber}`);

          completedParts++;
          setProgress(Math.round((completedParts / totalParts) * 100));
        };

        const queue = Array.from({ length: totalParts }, (_, i) => i + 1);
        const activeWorkers = new Set<Promise<void>>();

        while (queue.length > 0 || activeWorkers.size > 0) {
          while (queue.length > 0 && activeWorkers.size < UPLOAD_CONCURRENCY) {
            const partNum = queue.shift()!;
            const promise = uploadPart(partNum)
              .then(() => {
                activeWorkers.delete(promise);
              })
              .catch((err) => {
                activeWorkers.delete(promise);
                throw err;
              });
            activeWorkers.add(promise);
          }
          if (activeWorkers.size > 0) {
            await Promise.race(activeWorkers);
          }
        }

        // 3. Get authoritative ETags from server (avoids CORS ETag exposure issues)
        const listRes = await fetch('/api/uploads/multipart/list-parts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uploadId, key }),
        });
        if (!listRes.ok) throw new Error('Failed to verify uploaded parts');
        const { parts: verifiedParts }: { parts: { PartNumber: number; ETag: string }[] } =
          await listRes.json();

        if (verifiedParts.length !== totalParts) {
          throw new Error(
            `Upload incomplete: expected ${totalParts} parts, server confirmed ${verifiedParts.length}`
          );
        }

        // 4. Complete multipart upload with server-verified ETags
        const completeRes = await fetch('/api/uploads/multipart/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key,
            uploadId,
            parts: verifiedParts.map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })),
          }),
        });
        if (!completeRes.ok) {
          let detail = '';
          try {
            const body = await completeRes.json();
            detail = body.detail || body.error || '';
          } catch {
            /* ignore parse errors */
          }
          throw new Error(`Failed to finalize upload${detail ? `: ${detail}` : ''}`);
        }
        const { s3Url: uploadedUrl } = await completeRes.json();

        onUploaded({ s3Key: key, s3Url: uploadedUrl, filename: file.name });
      } catch (err) {
        console.error('Upload failed:', err);
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setError(msg);
      } finally {
        setUploading(false);
        setProgress(0);
      }
    },
    [onUploaded, keyPrefix]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('video/')) {
        uploadFile(file);
      }
    },
    [uploadFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        uploadFile(file);
      }
      // Reset input
      e.target.value = '';
    },
    [uploadFile]
  );

  if (s3Key && s3Url) {
    return (
      <div className={cn('relative rounded-lg border border-border bg-muted/30 p-4', className)}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-green-100 dark:bg-green-900/30">
              <Upload className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{label}</p>
              <p className="text-xs text-muted-foreground truncate">{s3Key}</p>
            </div>
          </div>
          {onRemove && (
            <Button variant="ghost" size="sm" onClick={onRemove} className="shrink-0">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors',
        dragOver
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
          : 'border-border hover:border-muted-foreground/50',
        uploading && 'pointer-events-none opacity-70',
        className
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {uploading ? (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">Uploading... {progress}%</p>
          <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </>
      ) : (
        <>
          <Upload className="h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">{label}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Drag & drop or{' '}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-blue-500 underline hover:text-blue-600"
            >
              browse
            </button>
          </p>
          {error && (
            <div className="mt-2 flex flex-col items-center gap-1">
              <p className="text-xs text-destructive">{error}</p>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                Dismiss
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
