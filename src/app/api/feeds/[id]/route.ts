// /src/app/api/feeds/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../auth';
import { deleteFromS3 } from '@shared/lib/s3';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Find all FeedVideos for this feed
    const feedVideos = await prisma.feedVideo.findMany({ where: { feedId: id } });

    // Delete each video from S3
    for (const video of feedVideos) {
      if (video.s3Url) {
        const urlParts = video.s3Url.split('.amazonaws.com/');
        if (urlParts.length === 2) {
          const s3Key = urlParts[1];
          try {
            await deleteFromS3(s3Key);
          } catch (err) {
            console.error('Failed to delete video from S3:', err);
          }
        }
      }
    }

    // Delete FeedVideos from DB
    await prisma.feedVideo.deleteMany({ where: { feedId: id } });

    // Delete the feed itself
    await prisma.videoFeed.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete feed:', err);
    return NextResponse.json({ error: 'Failed to delete feed' }, { status: 500 });
  }
}
