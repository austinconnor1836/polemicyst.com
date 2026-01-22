import { NextRequest, NextResponse } from 'next/server';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

const redisHost = process.env.REDIS_HOST || 'localhost';
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
      llmProvider,
      clipLength,
    } = await req.json();

    if (!feedVideoId || !userId) {
      return NextResponse.json({ error: 'Missing feedVideoId or userId' }, { status: 400 });
    }

    const existingJob = await clipGenerationQueue.getJob(feedVideoId);
    if (existingJob) {
      const state = await existingJob.getState();
      // If job is running or queued, don't interfere—just return success for idempotency.
      if (state === 'active' || state === 'waiting' || state === 'delayed') {
        console.log(`Job ${feedVideoId} is already ${state}. Returning existing job.`);
        return NextResponse.json({
          message: 'Clip generation already in progress',
          jobId: existingJob.id,
        });
      }

      // If job is finished/failed, try to remove it to allow a retry.
      try {
        await existingJob.remove();
      } catch (err: any) {
        // If it's locked (e.g. stalled but not detected yet), we can't remove it.
        // In that case, we can't add a new one with the same ID either.
        console.warn(`Could not remove existing job ${feedVideoId}: ${err.message}`);
        return NextResponse.json({ message: 'Job is locked or stuck', jobId: existingJob.id });
      }
    }

    const resolvedProvider =
      typeof llmProvider === 'string' && llmProvider.toLowerCase() === 'ollama'
        ? 'ollama'
        : 'gemini';

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
        llmProvider: resolvedProvider,
        clipLength,
      },
      { jobId: feedVideoId }
    );

    return NextResponse.json({ message: 'Clip-generation job enqueued', jobId: job.id });
  } catch (err) {
    console.error('Failed to enqueue job:', err);
    return NextResponse.json({ error: 'Enqueue failed' }, { status: 500 });
  }
}
