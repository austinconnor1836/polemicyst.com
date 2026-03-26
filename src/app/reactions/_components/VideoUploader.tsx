'use client';

import { useState, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Upload, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface DeferredFileData {
  file: File;
  blobUrl: string;
  filename: string;
}

interface VideoUploaderProps {
  label: string;
  s3Key?: string | null;
  s3Url?: string | null;
  onUploaded?: (data: { s3Key: string; s3Url: string; filename: string }) => void;
  /** When true, skips S3 upload and returns the raw File via onFileSelected */
  deferred?: boolean;
  onFileSelected?: (data: DeferredFileData) => void;
  onRemove?: () => void;
  className?: string;
  keyPrefix?: string;
}

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks

export function VideoUploader({
  label,
  s3Key,
  s3Url,
  onUploaded,
  deferred,
  onFileSelected,
  onRemove,
  className,
  keyPrefix,
}: VideoUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(
    async (file: File) => {
      if (deferred && onFileSelected) {
        const blobUrl = URL.createObjectURL(file);
        onFileSelected({ file, blobUrl, filename: file.name });
        return;
      }

      if (!onUploaded) return;

      setUploading(true);
      setProgress(0);

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
        if (!initRes.ok) throw new Error('Failed to initiate upload');
        const { uploadId, key } = await initRes.json();

        // 2. Upload parts
        const totalParts = Math.ceil(file.size / CHUNK_SIZE);
        const etags: { PartNumber: number; ETag: string }[] = [];

        for (let i = 0; i < totalParts; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunk = file.slice(start, end);
          const partNumber = i + 1;

          // Get presigned URL for this part
          const urlRes = await fetch('/api/uploads/multipart/part-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, uploadId, partNumber }),
          });
          if (!urlRes.ok) throw new Error(`Failed to get part URL for part ${partNumber}`);
          const { url } = await urlRes.json();

          // Upload the chunk
          const uploadRes = await fetch(url, {
            method: 'PUT',
            body: chunk,
          });
          if (!uploadRes.ok) throw new Error(`Failed to upload part ${partNumber}`);
          const etag = uploadRes.headers.get('ETag');
          etags.push({ PartNumber: partNumber, ETag: etag || '' });

          setProgress(Math.round(((i + 1) / totalParts) * 100));
        }

        // 3. Complete multipart upload
        const completeRes = await fetch('/api/uploads/multipart/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, uploadId, parts: etags }),
        });
        if (!completeRes.ok) throw new Error('Failed to complete upload');
        const { s3Url: uploadedUrl } = await completeRes.json();

        onUploaded({ s3Key: key, s3Url: uploadedUrl, filename: file.name });
      } catch (err) {
        console.error('Upload failed:', err);
        alert('Upload failed. Please try again.');
      } finally {
        setUploading(false);
        setProgress(0);
      }
    },
    [onUploaded, onFileSelected, deferred, keyPrefix]
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
        </>
      )}
    </div>
  );
}
