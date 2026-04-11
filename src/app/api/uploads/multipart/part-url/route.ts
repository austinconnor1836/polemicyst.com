import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { logUpload, getUploadContext } from '@shared/lib/upload-logger';
import { makeS3v2Client, S3_BUCKET } from '@/lib/s3-client';

const s3 = makeS3v2Client();

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startMs = Date.now();
  const { userAgent } = getUploadContext(req);

  try {
    const { uploadId, key, partNumber } = await req.json();

    const url = await s3.getSignedUrlPromise('uploadPart', {
      Bucket: S3_BUCKET,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Expires: 43200, // 12 hours — long uploads on slow connections need headroom
    });

    const durationMs = Date.now() - startMs;

    await logUpload({
      userId: user.id,
      stage: 'part-url',
      status: 'success',
      key,
      uploadId,
      partNumber,
      durationMs,
      userAgent,
    });

    return NextResponse.json({ url });
  } catch (error) {
    const durationMs = Date.now() - startMs;
    const errMsg = error instanceof Error ? error.message : String(error);

    let uploadId: string | undefined;
    let key: string | undefined;
    let partNumber: number | undefined;
    try {
      const body = await req.clone().json();
      uploadId = body.uploadId;
      key = body.key;
      partNumber = body.partNumber;
    } catch {
      /* ignore parse error on retry */
    }

    await logUpload({
      userId: user.id,
      stage: 'part-url',
      status: 'failed',
      key,
      uploadId,
      partNumber,
      durationMs,
      error: errMsg,
      userAgent,
      metadata: { stack: error instanceof Error ? error.stack : undefined },
    });

    console.error(
      `[upload:part-url] FAILED user=${user.id} uploadId=${uploadId} part=${partNumber} error=${errMsg} (${durationMs}ms)`
    );
    return NextResponse.json(
      { error: 'Failed to generate part URL', detail: errMsg },
      { status: 500 }
    );
  }
}
