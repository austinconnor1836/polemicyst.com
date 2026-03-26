import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import AWS from 'aws-sdk';
import { randomUUID } from 'crypto';

const S3_BUCKET = process.env.S3_BUCKET || 'clips-genie-uploads';
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';
const s3 = new AWS.S3({
  region: S3_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  signatureVersion: 'v4',
});

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userWithVideos = await prisma.user.findUnique({
    where: { id: user.id },
    include: { videos: true },
  });

  return Response.json(userWithVideos?.videos || []);
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File;
  const videoTitle = formData.get('videoTitle') as string;
  const fileName = formData.get('fileName') as string;

  if (!file || !videoTitle || !fileName) {
    return new Response('Missing fields', { status: 400 });
  }

  const userWithPrefs = await prisma.user.findUnique({
    where: { id: user.id },
    include: { templatePreferences: true },
  });

  if (!userWithPrefs) return new Response('User not found', { status: 404 });

  const preferences = userWithPrefs.templatePreferences;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const key = `video-uploads/${randomUUID()}-${fileName}`;

  await s3
    .upload({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: file.type,
    })
    .promise();

  const s3Url = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;

  const newVideo = await prisma.video.create({
    data: {
      userId: user.id,
      fileName,
      s3Key: key,
      s3Url,
      videoTitle,
      sharedDescription: '',
      facebookTemplate: preferences?.facebookTemplate || '',
      instagramTemplate: preferences?.instagramTemplate || '',
      youtubeTemplate: preferences?.youtubeTemplate || '',
      blueskyTemplate: '',
      twitterTemplate: '',
    },
  });

  return Response.json({ videoId: newVideo.id, s3Url });
}
