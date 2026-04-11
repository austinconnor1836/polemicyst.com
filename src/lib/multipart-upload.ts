/**
 * Standalone multipart S3 upload utility.
 *
 * Use this when you need to run multiple concurrent uploads with independent
 * progress tracking. Unlike VideoUploader's built-in flow, this function owns
 * no React state — the caller drives progress UI from the onProgress callback.
 *
 * Each call is fully isolated: its own AbortController, its own chunk queue,
 * its own ETag list. Multiple calls in parallel cannot interfere with each other.
 */

const CHUNK_SIZE = 25 * 1024 * 1024; // 25MB per part — matches VideoUploader for consistency
const CONCURRENCY = 6; // browser HTTP connection limit per origin
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

export interface MultipartUploadProgress {
  /** Bytes uploaded so far across all parts */
  loaded: number;
  /** Total file size in bytes */
  total: number;
  /** Rolling-average upload speed in bytes/sec */
  bytesPerSec: number;
  /** Percentage 0–100 */
  percent: number;
}

export interface MultipartUploadOptions {
  /** Optional S3 key prefix passed to /api/uploads/multipart/initiate */
  keyPrefix?: string;
  /** Called every ~250ms with current progress */
  onProgress?: (progress: MultipartUploadProgress) => void;
  /** Pass a controller's signal to allow external cancellation */
  signal?: AbortSignal;
}

export interface MultipartUploadResult {
  s3Key: string;
  s3Url: string;
}

class UploadHttpError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

function xhrPut(
  url: string,
  body: Blob,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);

    const onAbort = () => {
      try {
        xhr.abort();
      } catch {}
      reject(new UploadHttpError('Upload aborted', 0));
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.getResponseHeader('ETag') || '');
      } else {
        reject(new UploadHttpError(`Upload failed with status ${xhr.status}`, xhr.status));
      }
    };
    xhr.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new UploadHttpError('Upload network error', 0));
    };
    xhr.send(body);
  });
}

async function xhrPutWithRetry(
  initialUrl: string,
  body: Blob,
  onProgress: (loaded: number) => void,
  refreshUrl: () => Promise<string>,
  signal?: AbortSignal
): Promise<string> {
  let lastError: Error | null = null;
  let url = initialUrl;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new UploadHttpError('Upload aborted', 0);
    try {
      return await xhrPut(url, body, onProgress, signal);
    } catch (err) {
      lastError = err as Error;
      if (signal?.aborted) throw err;
      // Refresh presigned URL on 403 (expired)
      if (err instanceof UploadHttpError && err.status === 403) {
        try {
          url = await refreshUrl();
        } catch {
          // fall through to backoff
        }
      }
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError ?? new Error('Upload failed');
}

/**
 * Upload a file to S3 via the multipart upload API. Returns the final s3Key + s3Url.
 *
 * Throws on failure (including external abort via the signal). Caller should
 * surface the error to the user — this function does not log to console.
 */
export async function uploadFileMultipart(
  file: File,
  opts: MultipartUploadOptions = {}
): Promise<MultipartUploadResult> {
  const { keyPrefix, onProgress, signal } = opts;

  if (signal?.aborted) throw new UploadHttpError('Upload aborted', 0);

  // 1. Initiate the multipart upload
  const initRes = await fetch('/api/uploads/multipart/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || 'video/mp4',
      ...(keyPrefix ? { keyPrefix } : {}),
    }),
    signal,
  });
  if (!initRes.ok) throw new Error('Failed to initiate upload');
  const { uploadId, key } = (await initRes.json()) as { uploadId: string; key: string };

  // 2. Compute parts and fetch all presigned URLs in one batch
  const totalParts = Math.ceil(file.size / CHUNK_SIZE);
  const partNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);

  const batchRes = await fetch('/api/uploads/multipart/batch-part-urls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, key, partNumbers }),
    signal,
  });
  if (!batchRes.ok) throw new Error('Failed to fetch part URLs');
  const { urls } = (await batchRes.json()) as {
    urls: { partNumber: number; url: string }[];
  };
  const urlMap = new Map<number, string>(urls.map((u) => [u.partNumber, u.url]));

  // 3. Upload parts concurrently
  const etags: { PartNumber: number; ETag: string }[] = [];
  const queue = [...partNumbers];
  const activeWorkers = new Set<Promise<void>>();
  const chunkLoaded = new Map<number, number>();
  const startTime = Date.now();

  let lastProgressUpdate = 0;
  const PROGRESS_THROTTLE_MS = 250;
  const reportProgress = (force = false) => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastProgressUpdate < PROGRESS_THROTTLE_MS) return;
    lastProgressUpdate = now;
    let loaded = 0;
    for (const v of chunkLoaded.values()) loaded += v;
    const elapsed = Math.max(0.001, (now - startTime) / 1000);
    const bytesPerSec = loaded / elapsed;
    onProgress({
      loaded,
      total: file.size,
      bytesPerSec,
      percent: Math.min(100, Math.round((loaded / file.size) * 100)),
    });
  };

  const refreshPartUrl = async (partNumber: number): Promise<string> => {
    const res = await fetch('/api/uploads/multipart/part-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId, key, partNumber }),
      signal,
    });
    if (!res.ok) throw new Error('Failed to refresh part URL');
    const { url } = await res.json();
    urlMap.set(partNumber, url);
    return url;
  };

  const uploadPart = async (partNumber: number) => {
    if (signal?.aborted) throw new UploadHttpError('Upload aborted', 0);
    const start = (partNumber - 1) * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    const initialUrl = urlMap.get(partNumber);
    if (!initialUrl) throw new Error(`No URL for part ${partNumber}`);

    chunkLoaded.set(partNumber, 0);
    const etag = await xhrPutWithRetry(
      initialUrl,
      chunk,
      (loaded) => {
        chunkLoaded.set(partNumber, loaded);
        reportProgress();
      },
      () => refreshPartUrl(partNumber),
      signal
    );
    chunkLoaded.set(partNumber, end - start);
    reportProgress(true);
    etags.push({ PartNumber: partNumber, ETag: etag });
  };

  while (queue.length > 0 || activeWorkers.size > 0) {
    if (signal?.aborted) throw new UploadHttpError('Upload aborted', 0);
    while (queue.length > 0 && activeWorkers.size < CONCURRENCY) {
      const partNum = queue.shift()!;
      const promise = uploadPart(partNum).finally(() => {
        activeWorkers.delete(promise);
      });
      activeWorkers.add(promise);
    }
    if (activeWorkers.size > 0) {
      // If any worker rejects, Promise.race rejects too — bubble up
      await Promise.race(activeWorkers);
    }
  }

  // 4. Complete the upload
  etags.sort((a, b) => a.PartNumber - b.PartNumber);
  const completeRes = await fetch('/api/uploads/multipart/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, uploadId, parts: etags }),
    signal,
  });
  if (!completeRes.ok) {
    const detail = await completeRes.text().catch(() => '');
    throw new Error(`Failed to complete upload${detail ? `: ${detail}` : ''}`);
  }
  const { s3Url } = (await completeRes.json()) as { s3Url: string };
  return { s3Key: key, s3Url };
}
