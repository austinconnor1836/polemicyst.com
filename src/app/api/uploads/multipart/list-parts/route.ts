import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../../../auth';
import { S3Client, ListPartsCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  region: 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions) as any;
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { uploadId, key } = await req.json();

    const command = new ListPartsCommand({
      Bucket: 'clips-genie-uploads',
      Key: key,
      UploadId: uploadId,
    });

    const { Parts } = await s3.send(command);

    // Return simple array of uploaded parts
    const uploadedParts = Parts?.map((p) => ({
      PartNumber: p.PartNumber,
      ETag: p.ETag,
      Size: p.Size,
    })) || [];

    return NextResponse.json({ parts: uploadedParts });
  } catch (error) {
    console.error('List parts error:', error);
    return NextResponse.json({ error: 'Failed to list parts' }, { status: 500 });
  }
}
