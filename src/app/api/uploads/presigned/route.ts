import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../auth'; // Adjust path if needed
import AWS from 'aws-sdk';
import { randomUUID } from 'crypto';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { filename, contentType } = await req.json();

    const s3 = new AWS.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: 'us-east-2', // Hardcoded in existing s3.ts, using same here
      signatureVersion: 'v4',
    });

    const fileExt = filename.split('.').pop();
    const key = `uploads/${session.user.email}/${randomUUID()}.${fileExt}`;
    
    const presignedUrl = await s3.getSignedUrlPromise('putObject', {
      Bucket: 'clips-genie-uploads', // Hardcoded in existing s3.ts
      Key: key,
      ContentType: contentType || 'video/mp4',
      Expires: 60 * 5, // 5 minutes
    });

    return NextResponse.json({ url: presignedUrl, key });
  } catch (error) {
    console.error('Presigned URL error:', error);
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 });
  }
}
