import { NextRequest, NextResponse } from 'next/server';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { prisma } from '@shared/lib/prisma';
import { checkClipQuota } from '@/lib/plans';
import { logJob } from '@shared/lib/job-logger';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';

let redis: Redis | null = null;
let clipGenerationQueue: Queue | null = null;

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

export async function POST(req: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      feedVideoId,
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

    const userId = authUser.id;

    if (!feedVideoId) {
      return NextResponse.json({ error: 'Missing feedVideoId' }, { status: 400 });
    }

    const feedVideo = await prisma.feedVideo.findUnique({
      where: { id: feedVideoId },
      select: { userId: true },
    });
    if (!feedVideo || feedVideo.userId !== userId) {
      return NextResponse.json({ error: 'Feed video not found' }, { status: 404 });
    }

    const clipQuota = await checkClipQuota(userId, authUser.subscriptionPlan);
    if (!clipQuota.allowed) {
      return NextResponse.json(
        {
          error: clipQuota.message,
          code: 'QUOTA_EXCEEDED',
          limit: clipQuota.limit,
          usage: clipQuota.currentUsage,
        },
        { status: 403 }
      );
    }

    const queue = getClipGenerationQueue();
    const existingJob = await queue.getJob(feedVideoId);
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

    // Track clip generation status
    await prisma.feedVideo.update({
      where: { id: feedVideoId },
      data: { clipGenerationStatus: 'queued', clipGenerationError: null },
    });

    const resolvedProvider =
      typeof llmProvider === 'string' && llmProvider.toLowerCase() === 'ollama'
        ? 'ollama'
        : 'gemini';

    const job = await queue.add(
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
      { jobId: feedVideoId, removeOnComplete: true, removeOnFail: true }
    );

    await logJob({
      feedVideoId,
      jobType: 'clip-generation',
      status: 'queued',
      message: 'Clip-generation job queued via API',
    });

    return NextResponse.json({ message: 'Clip-generation job enqueued', jobId: job.id });
  } catch (err) {
    console.error('Failed to enqueue job:', err);
    return NextResponse.json({ error: 'Enqueue failed' }, { status: 500 });
  }
}
