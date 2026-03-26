import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { ListPartsCommand } from '@aws-sdk/client-s3';
import { makeS3v3Client, S3_BUCKET } from '@/lib/s3-client';

const s3 = makeS3v3Client();

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { uploadId, key } = await req.json();

    const command = new ListPartsCommand({
      Bucket: S3_BUCKET,
      Key: key,
      UploadId: uploadId,
    });

    const { Parts } = await s3.send(command);

    // Return simple array of uploaded parts
    const uploadedParts =
      Parts?.map((p) => ({
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
