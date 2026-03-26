import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { logUpload, getUploadContext } from '@shared/lib/upload-logger';
import { makeS3v2Client, S3_BUCKET } from '@/lib/s3-client';

const s3 = makeS3v2Client();

const MAX_PARTS = 1000;

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startMs = Date.now();
  const { userAgent } = getUploadContext(req);

  try {
    const { uploadId, key, partNumbers } = await req.json();

    if (!Array.isArray(partNumbers) || partNumbers.length === 0) {
      return NextResponse.json({ error: 'partNumbers must be a non-empty array' }, { status: 400 });
    }
    if (partNumbers.length > MAX_PARTS) {
      return NextResponse.json(
        { error: `partNumbers exceeds max of ${MAX_PARTS}` },
        { status: 400 }
      );
    }

    const urls = await Promise.all(
      partNumbers.map(async (partNumber: number) => {
        const url = await s3.getSignedUrlPromise('uploadPart', {
          Bucket: S3_BUCKET,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Expires: 3600,
        });
        return { partNumber, url };
      })
    );

    const durationMs = Date.now() - startMs;

    await logUpload({
      userId: user.id,
      stage: 'part-url',
      status: 'success',
      key,
      uploadId,
      durationMs,
      userAgent,
      metadata: { batch: true, partCount: partNumbers.length },
    });

    return NextResponse.json({ urls });
  } catch (error) {
    const durationMs = Date.now() - startMs;
    const errMsg = error instanceof Error ? error.message : String(error);

    await logUpload({
      userId: user.id,
      stage: 'part-url',
      status: 'failed',
      durationMs,
      error: errMsg,
      userAgent,
      metadata: { batch: true, stack: error instanceof Error ? error.stack : undefined },
    });

    console.error(
      `[upload:batch-part-urls] FAILED user=${user.id} error=${errMsg} (${durationMs}ms)`
    );
    return NextResponse.json(
      { error: 'Failed to generate batch part URLs', detail: errMsg },
      { status: 500 }
    );
  }
}
