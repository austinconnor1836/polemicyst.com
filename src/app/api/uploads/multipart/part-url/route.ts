import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import AWS from 'aws-sdk';
import { logUpload, getUploadContext } from '@shared/lib/upload-logger';

const S3_BUCKET = process.env.S3_BUCKET || 'clips-genie-uploads';
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: S3_REGION,
  signatureVersion: 'v4',
});

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
      Expires: 3600, // 1 hour — background uploads may be delayed by the OS
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
