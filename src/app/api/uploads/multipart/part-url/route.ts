import { NextRequest, NextResponse } from 'next/server';
import AWS from 'aws-sdk';
import { resolveUser, withAnonCookie } from '@/lib/anonymous-session';

const S3_BUCKET = process.env.S3_BUCKET || 'clips-genie-uploads';
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: S3_REGION,
  signatureVersion: 'v4',
});

export async function POST(req: NextRequest) {
  const { newAnonId } = await resolveUser();

  try {
    const { uploadId, key, partNumber } = await req.json();

    const url = await s3.getSignedUrlPromise('uploadPart', {
      Bucket: S3_BUCKET,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Expires: 300,
    });

    return withAnonCookie(NextResponse.json({ url }), newAnonId);
  } catch (error) {
    console.error('Presign part error:', error);
    return withAnonCookie(
      NextResponse.json({ error: 'Failed to generate part URL' }, { status: 500 }),
      newAnonId
    );
  }
}
