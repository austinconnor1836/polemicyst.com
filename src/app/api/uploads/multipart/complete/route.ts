import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { CompleteMultipartUploadCommand } from '@aws-sdk/client-s3';
import { logUpload, getUploadContext } from '@shared/lib/upload-logger';
import { makeS3v3Client, S3_BUCKET, S3_REGION } from '@/lib/s3-client';

const s3 = makeS3v3Client();

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
