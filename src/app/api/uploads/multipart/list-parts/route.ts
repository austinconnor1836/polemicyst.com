import { NextRequest, NextResponse } from 'next/server';
import { S3Client, ListPartsCommand } from '@aws-sdk/client-s3';
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
  const { newAnonId } = await resolveUser();

  try {
    const { uploadId, key } = await req.json();

    const command = new ListPartsCommand({
      Bucket: S3_BUCKET,
      Key: key,
      UploadId: uploadId,
    });

    const { Parts } = await s3.send(command);

    const uploadedParts =
      Parts?.map((p) => ({
        PartNumber: p.PartNumber,
        ETag: p.ETag,
        Size: p.Size,
      })) || [];

    return withAnonCookie(NextResponse.json({ parts: uploadedParts }), newAnonId);
  } catch (error) {
    console.error('List parts error:', error);
    return withAnonCookie(
      NextResponse.json({ error: 'Failed to list parts' }, { status: 500 }),
      newAnonId
    );
  }
}
