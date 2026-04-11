'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Upload, Loader2, Trash2, RotateCcw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { VideoCard } from '@/components/ui/video-card';
import { probeVideo } from '@/lib/probe-video';

export type UploadStatus = 'idle' | 'uploading' | 'complete' | 'error';

interface FileSelectedData {
  blobUrl: string;
  file: File;
  filename: string;
  fileSize: number;
  durationS: number;
  width: number;
  height: number;
}

interface UploadCompleteData {
  s3Key: string;
  s3Url: string;
}

interface VideoUploaderProps {
  label: string;
  s3Key?: string | null;
  s3Url?: string | null;
  blobUrl?: string | null;
  uploadProgress?: number | null;
  uploadSpeed?: number | null;
  uploadStatus?: UploadStatus;
  onFileSelected: (data: FileSelectedData) => void;
  onUploadComplete: (data: UploadCompleteData) => void;
  onUploadError?: (error: string) => void;
  onUploadProgress?: (progress: number, speed: number) => void;
  onRemove?: () => void;
  className?: string;
  keyPrefix?: string;
  /** If true, skip S3 upload — just provide local file for client-side rendering */
  localOnly?: boolean;
  /** Pre-loaded file to auto-start uploading on mount (e.g. restored from IndexedDB after refresh) */
  initialFile?: File | null;
}

const CHUNK_SIZE = 25 * 1024 * 1024; // 25MB chunks — balances parallelism with per-chunk overhead
const CONCURRENCY = 6; // Browser HTTP/1.1 limit per origin; matches max simultaneous connections
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** localStorage key for persisting upload state by S3 key */
function storageKey(key: string): string {
  return `upload:${key}`;
}

/** Predictable key to find an in-progress upload across page refreshes */
function resumeKey(keyPrefix: string, filename: string, fileSize: number): string {
  return `upload-resume:${keyPrefix}:${filename}:${fileSize}`;
}

interface PersistedUpload {
  uploadId: string;
  key: string;
  filename: string;
  fileSize: number;
  totalParts: number;
  completedParts: number[];
}

function persistUploadState(state: PersistedUpload, prefix?: string) {
  try {
    localStorage.setItem(storageKey(state.key), JSON.stringify(state));
    // Also store a resume lookup so we can find this upload after refresh
    if (prefix) {
      localStorage.setItem(resumeKey(prefix, state.filename, state.fileSize), state.key);
    }
  } catch {
    // Non-fatal
  }
}

function clearUploadState(key: string, prefix?: string, filename?: string, fileSize?: number) {
  try {
    localStorage.removeItem(storageKey(key));
    if (prefix && filename && fileSize != null) {
      localStorage.removeItem(resumeKey(prefix, filename, fileSize));
    }
  } catch {
    // Non-fatal
  }
}

function loadUploadState(key: string): PersistedUpload | null {
  try {
    const raw = localStorage.getItem(storageKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Find an existing upload for this file (by prefix + name + size) */
function findExistingUpload(
  prefix: string,
  filename: string,
  fileSize: number
): PersistedUpload | null {
  try {
    const key = localStorage.getItem(resumeKey(prefix, filename, fileSize));
    if (!key) return null;
    return loadUploadState(key);
  } catch {
    return null;
  }
}

/** Upload a blob via XHR with byte-level progress and retry */
class UploadHttpError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

function xhrPut(url: string, body: Blob, onProgress: (loaded: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.getResponseHeader('ETag') || '');
      } else {
        reject(new UploadHttpError(`Upload failed with status ${xhr.status}`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new UploadHttpError('Upload network error', 0));
    xhr.send(body);
  });
}

/**
 * Upload a chunk with retries. If the presigned URL expired (403), refresh it
 * via the provided `refreshUrl` callback and retry with the new URL.
 */
async function xhrPutWithRetry(
  initialUrl: string,
  body: Blob,
  onProgress: (loaded: number) => void,
  refreshUrl?: () => Promise<string>
): Promise<string> {
  let lastError: Error | null = null;
  let url = initialUrl;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await xhrPut(url, body, onProgress);
    } catch (err) {
      lastError = err as Error;
      // On 403 (expired presigned URL), refresh the URL before retrying
      if (err instanceof UploadHttpError && err.status === 403 && refreshUrl) {
        try {
          url = await refreshUrl();
        } catch {
          // If refresh fails, fall through to backoff retry with old URL
        }
      }
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

export function VideoUploader({
  label,
  s3Key,
  s3Url,
  blobUrl,
  uploadProgress,
  uploadSpeed,
  uploadStatus = 'idle',
  onFileSelected,
  onUploadComplete,
  onUploadError,
  onUploadProgress,
  onRemove,
  className,
  keyPrefix,
  localOnly,
  initialFile,
}: VideoUploaderProps) {
  const [dragOver, setDragOver] = useState(false);
  const [internalProgress, setInternalProgress] = useState(0);
  const [internalSpeed, setInternalSpeed] = useState(0);
  const [internalEta, setInternalEta] = useState(0);
  const [internalStatus, setInternalStatus] = useState<UploadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [durationS, setDurationS] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);
  const abortRef = useRef(false);
  // Refs for callbacks so the running upload always calls the latest version
  const onUploadCompleteRef = useRef(onUploadComplete);
  onUploadCompleteRef.current = onUploadComplete;
  const onUploadErrorRef = useRef(onUploadError);
  onUploadErrorRef.current = onUploadError;
  const onUploadProgressRef = useRef(onUploadProgress);
  onUploadProgressRef.current = onUploadProgress;

  // Use external state if provided, otherwise internal
  const progress = uploadProgress ?? internalProgress;
  const speed = uploadSpeed ?? internalSpeed;
  const status = uploadStatus !== 'idle' ? uploadStatus : internalStatus;

  const startUpload = useCallback(
    async (file: File) => {
      abortRef.current = false;
      setInternalStatus('uploading');
      setInternalProgress(0);
      setInternalSpeed(0);
      setInternalEta(0);
      setErrorMessage(null);

      try {
        // 1. Check for an existing in-progress upload (resume after page refresh).
        // Verify the multipart upload still exists in S3 — it may have been aborted
        // or expired. If verification fails, fall through to initiating a fresh one.
        let existing = keyPrefix ? findExistingUpload(keyPrefix, file.name, file.size) : null;
        if (existing) {
          try {
            const verifyRes = await fetch(
              `/api/uploads/multipart/list-parts?uploadId=${encodeURIComponent(existing.uploadId)}&key=${encodeURIComponent(existing.key)}`
            );
            if (!verifyRes.ok) {
              console.warn(
                `[upload] Stale resume state for ${file.name} — multipart upload no longer exists, starting fresh`
              );
              clearUploadState(existing.key, keyPrefix, file.name, file.size);
              existing = null;
            }
          } catch {
            console.warn(
              `[upload] Failed to verify resume state for ${file.name} — starting fresh`
            );
            clearUploadState(existing.key, keyPrefix, file.name, file.size);
            existing = null;
          }
        }

        let uploadId: string;
        let key: string;

        if (existing) {
          // Resume the existing multipart upload
          uploadId = existing.uploadId;
          key = existing.key;
          console.log(
            `[upload] Resuming upload for ${file.name} (${existing.completedParts.length}/${existing.totalParts} parts done)`
          );
        } else {
          // Initiate a new multipart upload
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
          ({ uploadId, key } = await initRes.json());
        }

        // 2. Fetch all presigned URLs in one batch
        const totalParts = Math.ceil(file.size / CHUNK_SIZE);
        const partNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);

        // Load completed parts from persisted state
        const completedSet = new Set<number>(existing?.completedParts ?? []);

        // Persist initial state (with resume lookup)
        persistUploadState(
          {
            uploadId,
            key,
            filename: file.name,
            fileSize: file.size,
            totalParts,
            completedParts: [...completedSet],
          },
          keyPrefix
        );

        // If we have completed parts, verify with S3
        if (completedSet.size > 0) {
          try {
            const listRes = await fetch(
              `/api/uploads/multipart/list-parts?uploadId=${encodeURIComponent(uploadId)}&key=${encodeURIComponent(key)}`
            );
            if (listRes.ok) {
              const { parts } = await listRes.json();
              const verifiedParts = new Set(parts.map((p: { PartNumber: number }) => p.PartNumber));
              // Only keep parts that S3 confirms
              for (const p of completedSet) {
                if (!verifiedParts.has(p)) completedSet.delete(p);
              }
            }
          } catch {
            // If verification fails, upload all parts
            completedSet.clear();
          }
        }

        const remainingParts = partNumbers.filter((p) => !completedSet.has(p));

        const batchRes = await fetch('/api/uploads/multipart/batch-part-urls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uploadId, key, partNumbers: remainingParts }),
        });
        if (!batchRes.ok) throw new Error('Failed to get batch part URLs');
        const { urls: batchUrls } = await batchRes.json();
        const urlMap = new Map<number, string>(
          batchUrls.map((u: { partNumber: number; url: string }) => [u.partNumber, u.url])
        );

        // 3. Upload parts concurrently with byte-level progress
        const etags: { PartNumber: number; ETag: string }[] = [];
        const queue = [...remainingParts];
        const activeWorkers = new Set<Promise<void>>();

        // Track per-chunk loaded bytes for smooth progress
        const chunkLoaded = new Map<number, number>();
        // Pre-fill completed parts
        for (const p of completedSet) {
          const start = (p - 1) * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          chunkLoaded.set(p, end - start);
        }
        const startTime = Date.now();

        // Throttle progress updates to max 4/sec — XHR fires hundreds of
        // progress events across concurrent uploads, each causing React re-renders
        let lastProgressUpdate = 0;
        const PROGRESS_THROTTLE_MS = 250;

        const updateProgress = (force = false) => {
          const now = Date.now();
          if (!force && now - lastProgressUpdate < PROGRESS_THROTTLE_MS) return;
          lastProgressUpdate = now;

          let totalLoaded = 0;
          for (const loaded of chunkLoaded.values()) {
            totalLoaded += loaded;
          }
          const pct = Math.min(100, Math.round((totalLoaded / file.size) * 100));
          setInternalProgress(pct);

          const elapsed = (now - startTime) / 1000;
          if (elapsed > 0.5) {
            const bytesPerSec = totalLoaded / elapsed;
            setInternalSpeed(bytesPerSec);
            setInternalEta(bytesPerSec > 0 ? (file.size - totalLoaded) / bytesPerSec : 0);
          }
          const bytesPerSec = elapsed > 0.5 ? totalLoaded / elapsed : 0;
          onUploadProgressRef.current?.(pct, bytesPerSec);
        };

        // Show initial progress for resumed uploads
        updateProgress();

        const uploadPart = async (partNumber: number) => {
          if (abortRef.current) return;
          const start = (partNumber - 1) * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunk = file.slice(start, end);
          const initialUrl = urlMap.get(partNumber);
          if (!initialUrl) throw new Error(`No URL for part ${partNumber}`);

          chunkLoaded.set(partNumber, 0);

          // Refresh callback for when the presigned URL expires mid-upload
          const refreshUrl = async (): Promise<string> => {
            const res = await fetch('/api/uploads/multipart/part-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ uploadId, key, partNumber }),
            });
            if (!res.ok) throw new Error('Failed to refresh part URL');
            const { url } = await res.json();
            urlMap.set(partNumber, url);
            return url;
          };

          const etag = await xhrPutWithRetry(
            initialUrl,
            chunk,
            (loaded) => {
              chunkLoaded.set(partNumber, loaded);
              updateProgress();
            },
            refreshUrl
          );

          chunkLoaded.set(partNumber, end - start);
          updateProgress(true);

          etags.push({ PartNumber: partNumber, ETag: etag });
          completedSet.add(partNumber);
          // Persist every 5 chunks (or on the last one) to reduce localStorage overhead
          if (completedSet.size % 5 === 0 || completedSet.size === totalParts) {
            persistUploadState(
              {
                uploadId,
                key,
                filename: file.name,
                fileSize: file.size,
                totalParts,
                completedParts: [...completedSet],
              },
              keyPrefix
            );
          }
        };

        while (queue.length > 0 || activeWorkers.size > 0) {
          if (abortRef.current) throw new Error('Upload cancelled');
          while (queue.length > 0 && activeWorkers.size < CONCURRENCY) {
            const partNum = queue.shift()!;
            const promise = uploadPart(partNum).then(
              () => {
                activeWorkers.delete(promise);
              },
              (err) => {
                activeWorkers.delete(promise);
                throw err;
              }
            );
            activeWorkers.add(promise);
          }
          if (activeWorkers.size > 0) {
            await Promise.race(activeWorkers);
          }
        }

        // 4. Complete multipart upload
        // Merge etags from resumed parts (we don't have their ETags, so re-list)
        let allEtags = etags;
        if (completedSet.size > remainingParts.length) {
          const listRes = await fetch(
            `/api/uploads/multipart/list-parts?uploadId=${encodeURIComponent(uploadId)}&key=${encodeURIComponent(key)}`
          );
          if (listRes.ok) {
            const { parts } = await listRes.json();
            allEtags = parts.map((p: { PartNumber: number; ETag: string }) => ({
              PartNumber: p.PartNumber,
              ETag: p.ETag,
            }));
          }
        }

        const completeRes = await fetch('/api/uploads/multipart/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, uploadId, parts: allEtags }),
        });
        if (!completeRes.ok) throw new Error('Failed to complete upload');
        const { s3Url: uploadedUrl } = await completeRes.json();

        clearUploadState(key, keyPrefix, file.name, file.size);
        setInternalStatus('complete');
        setInternalProgress(100);
        onUploadCompleteRef.current({ s3Key: key, s3Url: uploadedUrl });
      } catch (err) {
        if (abortRef.current) return;
        console.error('Upload failed:', err);
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setErrorMessage(msg);
        setInternalStatus('error');
        onUploadErrorRef.current?.(msg);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keyPrefix]
  );

  const handleFile = useCallback(
    async (file: File) => {
      fileRef.current = file;
      setFilename(file.name);
      const blobUrl = URL.createObjectURL(file);

      // Client-side probe for metadata — must complete BEFORE starting upload
      // so onFileSelected fires before onUploadComplete (prevents race where
      // upload finishes before probe and parent status gets stuck at 'uploading')
      const meta = await probeVideo(blobUrl);
      setDurationS(meta.durationS);

      // Fire so parent can show preview + enable editing
      onFileSelected({
        blobUrl,
        file,
        filename: file.name,
        fileSize: file.size,
        durationS: meta.durationS,
        width: meta.width,
        height: meta.height,
      });

      if (localOnly) {
        // Skip S3 upload — mark as complete immediately
        setInternalStatus('complete');
        setInternalProgress(100);
      } else {
        startUpload(file);
      }
    },
    [onFileSelected, startUpload, localOnly]
  );

  const handleRetry = useCallback(() => {
    if (fileRef.current) {
      startUpload(fileRef.current);
    }
  }, [startUpload]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('video/')) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFile(file);
      }
      e.target.value = '';
    },
    [handleFile]
  );

  // Auto-start upload for a pre-loaded file (e.g. restored from cache after page refresh)
  const initialFileHandled = useRef(false);
  useEffect(() => {
    if (initialFile && !initialFileHandled.current) {
      initialFileHandled.current = true;
      handleFile(initialFile);
    }
  }, [initialFile, handleFile]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      abortRef.current = true;
    };
  }, []);

  const hasVideo = !!(s3Key && s3Url) || !!blobUrl;
  const videoSrc = s3Url || blobUrl;

  // State: has a video (uploading, complete, or error) — show preview with VideoCard
  if (hasVideo && videoSrc) {
    const displayDuration =
      durationS != null
        ? `${Math.floor(durationS / 60)}:${String(Math.floor(durationS % 60)).padStart(2, '0')}`
        : null;

    return (
      <VideoCard
        size="md"
        src={videoSrc}
        label={filename || label}
        badge={
          displayDuration ? (
            <Badge variant="secondary" className="text-[11px] shrink-0">
              {displayDuration}
            </Badge>
          ) : undefined
        }
        className={className}
        overlay={
          <>
            {/* Upload progress overlay */}
            {status === 'uploading' && (
              <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 to-transparent p-3 pt-8">
                <div className="flex items-center justify-between text-xs text-white/90 mb-1.5">
                  <span>Uploading... {progress}%</span>
                  {speed > 0 && (
                    <span>
                      {formatBytes(speed)}/s
                      {internalEta > 0 ? ` • ${formatEta(internalEta)}` : ''}
                    </span>
                  )}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                  <div
                    className="h-full rounded-full bg-blue-400 transition-[width] duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Error overlay with retry */}
            {status === 'error' && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
                <AlertCircle className="h-8 w-8 text-red-400 mb-2" />
                <p className="text-sm text-white/90 mb-1">Upload failed</p>
                {errorMessage && (
                  <p className="text-xs text-white/60 mb-3 max-w-[200px] text-center truncate">
                    {errorMessage}
                  </p>
                )}
                <Button variant="secondary" size="sm" onClick={handleRetry} className="gap-1.5">
                  <RotateCcw className="h-3.5 w-3.5" />
                  Retry
                </Button>
              </div>
            )}

            {/* Remove / cancel button — z-20 so it sits above the z-10 error overlay.
                Always visible on error state so the user can delete a failed upload. */}
            {onRemove && (
              <Button
                variant="secondary"
                size="icon"
                className={cn(
                  'absolute right-1.5 top-1.5 z-20 h-7 w-7 rounded-full bg-white/85 text-gray-900 backdrop-blur transition-opacity hover:bg-white dark:bg-zinc-900/80 dark:text-zinc-100 dark:hover:bg-zinc-900',
                  status === 'error' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  if (
                    !confirm(status === 'uploading' ? 'Cancel this upload?' : 'Remove this video?')
                  )
                    return;
                  abortRef.current = true;
                  onRemove();
                }}
                title={status === 'uploading' ? 'Cancel upload' : 'Remove video'}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        }
      />
    );
  }

  // State: empty drop zone
  return (
    <div
      className={cn(
        'relative flex min-h-[11rem] flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors',
        dragOver
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
          : 'border-border hover:border-muted-foreground/50',
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
    </div>
  );
}
