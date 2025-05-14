import { NextRequest, NextResponse } from 'next/server';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

const redis = new Redis({
  host: 'redis',
  port: 6379,
  maxRetriesPerRequest: null,
});

const clipGenerationQueue = new Queue('clip-generation', { connection: redis });

export async function POST(req: NextRequest) {
  try {
    const { feedVideoId, userId } = await req.json();

    if (!feedVideoId || !userId) {
      return NextResponse.json({ error: 'Missing feedVideoId or userId' }, { status: 400 });
    }

    const job = await clipGenerationQueue.add('clip-generation', { feedVideoId, userId }, {
      jobId: feedVideoId,
    });

    return NextResponse.json({ message: 'Clip-generation job enqueued', jobId: job.id });
  } catch (err) {
    console.error('Failed to enqueue job:', err);
    return NextResponse.json({ error: 'Enqueue failed' }, { status: 500 });
  }
}
