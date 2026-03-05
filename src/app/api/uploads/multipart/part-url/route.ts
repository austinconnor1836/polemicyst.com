import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../../auth';
import AWS from 'aws-sdk';

const S3_BUCKET = process.env.S3_BUCKET || 'clips-genie-uploads';
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: S3_REGION,
  signatureVersion: 'v4',
});

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions)) as any;
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { uploadId, key, partNumber } = await req.json();

    const url = await s3.getSignedUrlPromise('uploadPart', {
      Bucket: S3_BUCKET,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Expires: 300, // 5 min
    });

    return NextResponse.json({ url });
  } catch (error) {
    console.error('Presign part error:', error);
    return NextResponse.json({ error: 'Failed to generate part URL' }, { status: 500 });
  }
}
