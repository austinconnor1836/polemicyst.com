const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB

export interface S3UploadResult {
  s3Key: string;
  s3Url: string;
}

/**
 * Upload a File to S3 via the multipart upload API routes.
 * Returns the final s3Key and s3Url.
 */
export async function uploadFileToS3(
  file: File,
  keyPrefix: string,
  onProgress?: (pct: number) => void
): Promise<S3UploadResult> {
  // 1. Initiate
  const initRes = await fetch('/api/uploads/multipart/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || 'video/mp4',
      keyPrefix,
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

    const urlRes = await fetch('/api/uploads/multipart/part-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, uploadId, partNumber }),
    });
    if (!urlRes.ok) throw new Error(`Failed to get part URL for part ${partNumber}`);
    const { url } = await urlRes.json();

    const uploadRes = await fetch(url, { method: 'PUT', body: chunk });
    if (!uploadRes.ok) throw new Error(`Failed to upload part ${partNumber}`);
    const etag = uploadRes.headers.get('ETag');
    etags.push({ PartNumber: partNumber, ETag: etag || '' });

    onProgress?.(Math.round(((i + 1) / totalParts) * 100));
  }

  // 3. Complete
  const completeRes = await fetch('/api/uploads/multipart/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, uploadId, parts: etags }),
  });
  if (!completeRes.ok) throw new Error('Failed to complete upload');
  const { s3Url } = await completeRes.json();

  return { s3Key: key, s3Url };
}
