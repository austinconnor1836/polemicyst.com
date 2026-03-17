import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { S3Client, CreateMultipartUploadCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { logUpload, getUploadContext } from '@shared/lib/upload-logger';

const S3_BUCKET = process.env.S3_BUCKET || 'clips-genie-uploads';
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';

const s3 = new S3Client({
  region: S3_REGION,
  ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      }
    : {}),
});

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startMs = Date.now();
  const { userAgent } = getUploadContext(req);

  try {
    const { filename, contentType, keyPrefix } = await req.json();

    const fileExt = filename.split('.').pop() || 'mp4';
    const key = keyPrefix
      ? `${keyPrefix}/${randomUUID()}.${fileExt}`
      : `uploads/${user.email}/${randomUUID()}.${fileExt}`;

    console.info(
      `[upload:initiate] user=${user.id} email=${user.email} filename=${filename} contentType=${contentType} key=${key}`
    );

    const command = new CreateMultipartUploadCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: contentType || 'video/mp4',
    });

    const { UploadId } = await s3.send(command);
    const durationMs = Date.now() - startMs;

    await logUpload({
      userId: user.id,
      stage: 'initiate',
      status: 'success',
      filename,
      key,
      uploadId: UploadId,
      contentType: contentType || 'video/mp4',
      durationMs,
      userAgent,
    });

    console.info(
      `[upload:initiate] SUCCESS user=${user.id} uploadId=${UploadId} key=${key} (${durationMs}ms)`
    );

    return NextResponse.json({ uploadId: UploadId, key });
  } catch (error) {
    const durationMs = Date.now() - startMs;
    const errMsg = error instanceof Error ? error.message : String(error);

    await logUpload({
      userId: user.id,
      stage: 'initiate',
      status: 'failed',
      durationMs,
      error: errMsg,
      userAgent,
      metadata: { stack: error instanceof Error ? error.stack : undefined },
    });

    console.error(`[upload:initiate] FAILED user=${user.id} error=${errMsg} (${durationMs}ms)`);
    return NextResponse.json(
      { error: 'Failed to initiate upload', detail: errMsg },
      { status: 500 }
    );
  }
}
