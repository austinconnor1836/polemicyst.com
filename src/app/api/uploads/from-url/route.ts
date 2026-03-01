import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { resolveUser, withAnonCookie, checkAnonUploadLimit } from '@/lib/anonymous-session';

let redis: Redis | null = null;
let downloadQueue: Queue | null = null;

function getRedisConnection() {
  if (redis) return redis;
  redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: 6379,
    maxRetriesPerRequest: null,
  });
  return redis;
}

function getDownloadQueue() {
  if (downloadQueue) return downloadQueue;
  downloadQueue = new Queue('feed-download', { connection: getRedisConnection() });
  return downloadQueue;
}

export async function POST(req: NextRequest) {
  const { user, newAnonId } = await resolveUser();

  if (user.isAnonymous) {
    const quota = await checkAnonUploadLimit(user.id);
    if (!quota.allowed) {
      return withAnonCookie(
        NextResponse.json(
          {
            error: `You've used your ${quota.limit} free uploads. Sign up to continue.`,
            code: 'ANON_LIMIT',
            limit: quota.limit,
            count: quota.count,
          },
          { status: 403 }
        ),
        newAnonId
      );
    }
  }

  try {
    const { url, filename } = await req.json();

    if (!url || !String(url).startsWith('http')) {
      return withAnonCookie(
        NextResponse.json({ error: 'Invalid URL' }, { status: 400 }),
        newAnonId
      );
    }

    let manualFeed = await prisma.videoFeed.findFirst({
      where: { userId: user.id, sourceType: 'manual' },
    });

    if (!manualFeed) {
      manualFeed = await prisma.videoFeed.create({
        data: {
          userId: user.id,
          name: 'Manual Uploads',
          sourceType: 'manual',
          sourceUrl: 'manual://uploads',
          pollingInterval: 0,
        },
      });
    }

    const newVideo = await prisma.feedVideo.create({
      data: {
        feedId: manualFeed.id,
        userId: user.id,
        videoId: randomUUID(),
        title: filename || url.split('/').pop() || 'Imported Video',
        s3Url: url,
        status: 'pending',
      },
    });

    const queue = getDownloadQueue();
    await queue.add('download', {
      feedVideoId: newVideo.id,
      url,
      title: newVideo.title,
      feedId: manualFeed.id,
      userId: user.id,
    });

    return withAnonCookie(NextResponse.json(newVideo), newAnonId);
  } catch (error) {
    console.error('Import from URL error:', error);
    return withAnonCookie(
      NextResponse.json({ error: 'Failed to register video' }, { status: 500 }),
      newAnonId
    );
  }
}
