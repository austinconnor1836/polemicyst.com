import { NextRequest, NextResponse } from 'next/server';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

const redisHost =
  process.env.REDIS_HOST === 'redis' ? 'localhost' : process.env.REDIS_HOST || 'localhost';
const redis = new Redis({
  host: redisHost,
  port: 6379,
  maxRetriesPerRequest: null,
});

const clipGenerationQueue = new Queue('clip-generation', { connection: redis });

export async function POST(req: NextRequest) {
  try {
    const {
      feedVideoId,
      userId,
      aspectRatio,
      scoringMode,
      includeAudio,
      saferClips,
      targetPlatform,
      contentStyle,
      minCandidates,
      maxCandidates,
      minScore,
      percentile,
      maxGeminiCandidates,
    } = await req.json();

    if (!feedVideoId || !userId) {
      return NextResponse.json({ error: 'Missing feedVideoId or userId' }, { status: 400 });
    }

    const existingJob = await clipGenerationQueue.getJob(feedVideoId);
    if (existingJob) {
      await existingJob.remove();
    }

    const job = await clipGenerationQueue.add(
      'clip-generation',
      {
        feedVideoId,
        userId,
        aspectRatio,
        scoringMode,
        includeAudio,
        saferClips,
        targetPlatform,
        contentStyle,
        minCandidates,
        maxCandidates,
        minScore,
        percentile,
        maxGeminiCandidates,
      },
      { jobId: feedVideoId }
    );

    return NextResponse.json({ message: 'Clip-generation job enqueued', jobId: job.id });
  } catch (err) {
    console.error('Failed to enqueue job:', err);
    return NextResponse.json({ error: 'Enqueue failed' }, { status: 500 });
  }
}
