import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../auth';
import { prisma } from '@shared/lib/prisma';
import { randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { getStrictnessConfig, mergeViralitySettings, type ViralitySettingsValue } from '@shared/virality';

const redisHost = process.env.REDIS_HOST || 'localhost';
const redis = new Redis({
  host: redisHost,
  port: 6379,
  maxRetriesPerRequest: null,
});

const clipGenerationQueue = new Queue('clip-generation', { connection: redis });
const downloadQueue = new Queue('feed-download', { connection: redis });

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
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
        videoId: randomUUID(), // Internal ID
        title: filename || url.split('/').pop() || 'Imported Video',
        s3Url: url, // temporary; will be replaced after download
        status: 'pending',
      },
    });

    // 3. Enqueue download job
    await downloadQueue.add('download', {
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
