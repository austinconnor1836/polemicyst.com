import { prisma } from '@shared/lib/prisma';
import { randomUUID } from 'crypto';

export async function findOrCreateManualFeed(userId: string) {
  let manualFeed = await prisma.videoFeed.findFirst({
    where: { userId, sourceType: 'manual' },
  });

  if (!manualFeed) {
    manualFeed = await prisma.videoFeed.create({
      data: {
        userId,
        name: 'Manual Uploads',
        sourceType: 'manual',
        sourceUrl: 'manual://uploads',
        pollingInterval: 0,
      },
    });
  }

  return manualFeed;
}

interface CreateFeedVideoInput {
  feedId: string;
  userId: string;
  title: string;
  s3Url: string;
  status?: string;
  thumbnailUrl?: string;
}

export async function createFeedVideoRecord(input: CreateFeedVideoInput) {
  return prisma.feedVideo.create({
    data: {
      feedId: input.feedId,
      userId: input.userId,
      videoId: randomUUID(),
      title: input.title,
      s3Url: input.s3Url,
      status: input.status,
      thumbnailUrl: input.thumbnailUrl,
    },
  });
}
