import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

let redis: Redis | null = null;
let clipGenerationQueue: Queue | null = null;
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

function getClipGenerationQueue() {
  if (clipGenerationQueue) return clipGenerationQueue;
  clipGenerationQueue = new Queue('clip-generation', { connection: getRedisConnection() });
  return clipGenerationQueue;
}

function getDownloadQueue() {
  if (downloadQueue) return downloadQueue;
  downloadQueue = new Queue('feed-download', { connection: getRedisConnection() });
  return downloadQueue;
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { url, filename } = await req.json();

    if (!url || !String(url).startsWith('http')) {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }

    // 1. Find or create the "Manual Uploads" feed
    let manualFeed = await prisma.videoFeed.findFirst({
      where: {
        userId: user.id,
        sourceType: 'manual',
      },
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

    // 2. Create the FeedVideo record as "pending" and enqueue download
    const newVideo = await prisma.feedVideo.create({
      data: {
        feedId: manualFeed.id,
        userId: user.id,
        videoId: randomUUID(),
        title: filename || url.split('/').pop() || 'Imported Video',
        s3Url: url, // temporary; will be replaced after download
        status: 'pending',
      },
    });

    // 3. Enqueue download job
    const queue = getDownloadQueue();
    await queue.add('download', {
      feedVideoId: newVideo.id,
      url,
      title: newVideo.title,
      feedId: manualFeed.id,
      userId: user.id,
    });

    return NextResponse.json(newVideo);
  } catch (error) {
    console.error('Import from URL error:', error);
    return NextResponse.json({ error: 'Failed to register video' }, { status: 500 });
  }
}
