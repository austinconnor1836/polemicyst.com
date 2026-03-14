import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { S3Client, CompleteMultipartUploadCommand } from '@aws-sdk/client-s3';
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

    return NextResponse.json({ success: true, key });
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
