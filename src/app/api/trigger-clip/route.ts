import { NextRequest, NextResponse } from 'next/server';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { prisma } from '@shared/lib/prisma';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: 6379,
  maxRetriesPerRequest: null,
});

const clipGenerationQueue = new Queue('clip-generation', { connection: redis });

export async function POST(req: NextRequest) {
  try {
    const { feedVideoId, userId, aspectRatio } = await req.json();

    if (!feedVideoId || !userId) {
      return NextResponse.json({ error: 'Missing feedVideoId or userId' }, { status: 400 });
    }

    await prisma.feedVideo.update({
      where: { id: feedVideoId },
      data: { clipGenerationStatus: 'queued', clipGenerationError: null },
    });

    const job = await clipGenerationQueue.add(
      'clip-generation',
      { feedVideoId, userId, aspectRatio },
      { jobId: feedVideoId }
    );

    return NextResponse.json({ message: 'Clip-generation job enqueued', jobId: job.id });
  } catch (err) {
    console.error('Failed to enqueue job:', err);
    return NextResponse.json({ error: 'Enqueue failed' }, { status: 500 });
  }
}

