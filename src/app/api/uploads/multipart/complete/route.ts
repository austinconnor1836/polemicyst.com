import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import {
  CompleteMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { logUpload, getUploadContext } from '@shared/lib/upload-logger';
import { makeS3v3Client, S3_BUCKET, S3_REGION } from '@/lib/s3-client';

const s3 = makeS3v3Client();

/** Fetch a byte range from S3 as a Buffer */
async function fetchRange(key: string, start: number, end: number): Promise<Buffer> {
  const res = await s3.send(
    new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Range: `bytes=${start}-${end}`,
    })
  );
  const chunks: Buffer[] = [];
  const stream = res.Body as NodeJS.ReadableStream;
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Validate that an uploaded MP4 has a 'moov' atom (metadata box).
 * Returns true if valid, false if corrupt. We check the first 64KB and last 64KB
 * because the moov atom can be at the start (streaming-optimized) or end (camera default).
 */
async function validateMp4(key: string): Promise<boolean> {
  try {
    // Get file size
    const head = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    const size = head.ContentLength ?? 0;
    if (size < 16) return false; // Too small to be valid

    const checkSize = Math.min(65536, Math.floor(size / 2));

    // Fetch first 64KB and last 64KB in parallel
    const [head64, tail64] = await Promise.all([
      fetchRange(key, 0, checkSize - 1),
      size > checkSize * 2
        ? fetchRange(key, size - checkSize, size - 1)
        : Promise.resolve(Buffer.alloc(0)),
    ]);

    const moov = Buffer.from('moov');
    return head64.includes(moov) || tail64.includes(moov);
  } catch (err) {
    console.error('[validateMp4] Error:', err);
    return false;
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startMs = Date.now();
  const { userAgent } = getUploadContext(req);

  try {
    const { uploadId, key, parts } = await req.json();
    const sortedParts = parts.sort((a: any, b: any) => a.PartNumber - b.PartNumber);

    console.info(
      `[upload:complete-multipart] user=${user.id} uploadId=${uploadId} key=${key} parts=${sortedParts.length}`
    );

    const command = new CompleteMultipartUploadCommand({
      Bucket: S3_BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: sortedParts,
      },
    });

    await s3.send(command);

    // Validate the MP4 — reject corrupt files (missing moov atom) so they
    // don't pollute the system and fail downstream renders
    const isValidMp4 = key.match(/\.(mp4|mov|m4v)$/i) ? await validateMp4(key) : true;
    if (!isValidMp4) {
      // Delete the corrupt file from S3
      await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key })).catch(() => {});
      const durationMs = Date.now() - startMs;
      await logUpload({
        userId: user.id,
        stage: 'complete-multipart',
        status: 'failed',
        key,
        uploadId,
        durationMs,
        error: 'Corrupt MP4: missing moov atom',
        userAgent,
      });
      console.error(
        `[upload:complete-multipart] CORRUPT user=${user.id} key=${key} — missing moov atom, deleted`
      );
      return NextResponse.json(
        {
          error:
            'Uploaded video file is corrupt (missing moov atom). The source file may have been incomplete. Please try again with a fresh recording.',
        },
        { status: 422 }
      );
    }

    const durationMs = Date.now() - startMs;

    await logUpload({
      userId: user.id,
      stage: 'complete-multipart',
      status: 'success',
      key,
      uploadId,
      durationMs,
      userAgent,
      metadata: { partCount: sortedParts.length },
    });

    console.info(
      `[upload:complete-multipart] SUCCESS user=${user.id} uploadId=${uploadId} (${durationMs}ms)`
    );

    const s3Url = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;
    return NextResponse.json({ success: true, key, s3Url });
  } catch (error) {
    const durationMs = Date.now() - startMs;
    const errMsg = error instanceof Error ? error.message : String(error);

    await logUpload({
      userId: user.id,
      stage: 'complete-multipart',
      status: 'failed',
      durationMs,
      error: errMsg,
      userAgent,
      metadata: { stack: error instanceof Error ? error.stack : undefined },
    });

    console.error(
      `[upload:complete-multipart] FAILED user=${user.id} error=${errMsg} (${durationMs}ms)`
    );
    return NextResponse.json(
      { error: 'Failed to complete upload', detail: errMsg },
      { status: 500 }
    );
  }
}
