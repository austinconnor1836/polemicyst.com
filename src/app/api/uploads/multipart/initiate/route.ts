import { NextRequest, NextResponse } from 'next/server';
import { S3Client, CreateMultipartUploadCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { resolveUser, withAnonCookie } from '@/lib/anonymous-session';

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
  const { user, newAnonId } = await resolveUser();

  try {
    const { filename, contentType } = await req.json();

    const fileExt = filename.split('.').pop() || 'mp4';
    const ownerPrefix = user.isAnonymous ? `anon/${user.id}` : user.email;
    const key = `uploads/${ownerPrefix}/${randomUUID()}.${fileExt}`;

    const command = new CreateMultipartUploadCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: contentType || 'video/mp4',
    });

    const { UploadId } = await s3.send(command);

    return withAnonCookie(NextResponse.json({ uploadId: UploadId, key }), newAnonId);
  } catch (error) {
    console.error('Initiate multipart error:', error);
    return withAnonCookie(
      NextResponse.json({ error: 'Failed to initiate upload' }, { status: 500 }),
      newAnonId
    );
  }
}
