import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../auth';
import { deleteFromS3 } from '@shared/lib/s3';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const feedVideo = await prisma.feedVideo.findUnique({
      where: { id },
      include: {
        feed: true,
        generatedClips: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!feedVideo) {
      return NextResponse.json({ error: 'Feed video not found' }, { status: 404 });
    }

    return NextResponse.json(feedVideo);
  } catch (err) {
    console.error('[GET /api/feedVideos/:id] Unhandled error:', err);
    return NextResponse.json(
      { error: 'Failed to load feed video' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const feedVideo = await prisma.feedVideo.findUnique({
      where: { id },
    });

    if (!feedVideo) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (feedVideo.s3Url) {
      const urlParts = feedVideo.s3Url.split('.amazonaws.com/');
      if (urlParts.length === 2) {
        const s3Key = urlParts[1];
        try {
          await deleteFromS3(s3Key);
        } catch (err) {
          console.error('Failed to delete video from S3:', err);
        }
      }
    }

    await prisma.feedVideo.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete feed video:', err);
    return NextResponse.json({ error: 'Failed to delete feed video' }, { status: 500 });
  }
}
