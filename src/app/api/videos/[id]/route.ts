// /src/app/api/videos/[id]/route.ts
import { prisma } from '@shared/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../auth';
import { NextRequest } from 'next/server';
import AWS from 'aws-sdk';

const S3_BUCKET = process.env.S3_BUCKET || 'clips-genie-uploads';
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';

const s3 = new AWS.S3({
  region: S3_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  signatureVersion: 'v4',
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const video = await prisma.video.findUnique({
    where: { id },
  });

  if (!video) {
    return new Response('Video not found', { status: 404 });
  }

  return Response.json(video);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: videoId } = await params;
  const body = await req.json();

  try {
    const updated = await prisma.video.update({
      where: { id: videoId },
      data: {
        videoTitle: body.videoTitle,
        sharedDescription: body.sharedDescription,
        facebookTemplate: body.facebookTemplate,
        instagramTemplate: body.instagramTemplate,
        youtubeTemplate: body.youtubeTemplate,
        blueskyTemplate: body.blueskyTemplate,
        twitterTemplate: body.twitterTemplate,
      },
    });

    return new Response(JSON.stringify(updated), { status: 200 });
  } catch (err) {
    console.error('Failed to update video', err);
    return new Response('Failed to update video', { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    // Get the video entry to fetch S3 key before deletion
    const video = await prisma.video.findUnique({
      where: { id },
      select: { s3Key: true },
    });

    if (!video) {
      return new Response('Video not found', { status: 404 });
    }

    if (!video?.s3Key) {
      return new Response('Missing S3 key for this video', { status: 400 });
    }

    // Delete the video file from S3
    await s3
      .deleteObject({
        Bucket: S3_BUCKET,
        Key: video.s3Key,
      })
      .promise();

    // Delete the video record from DB
    await prisma.video.delete({
      where: { id },
    });

    return new Response('Video deleted', { status: 200 });
  } catch (error) {
    console.error('❌ Error deleting video:', error);
    return new Response('Failed to delete video', { status: 500 });
  }
}
