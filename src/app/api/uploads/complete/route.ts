import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import {
  getStrictnessConfig,
  mergeViralitySettings,
  type ViralitySettingsValue,
} from '@shared/virality';
import { checkClipQuota } from '@/lib/plans';
import { resolveUser, withAnonCookie, checkAnonUploadLimit } from '@/lib/anonymous-session';

const S3_BUCKET = process.env.S3_BUCKET || 'clips-genie-uploads';
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';

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
    const { key, filename } = await req.json();

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

    const s3Url = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;

    const newVideo = await prisma.feedVideo.create({
      data: {
        feedId: manualFeed.id,
        userId: user.id,
        videoId: randomUUID(),
        title: filename || 'Untitled Upload',
        s3Url: s3Url,
      },
    });

    if (!user.isAnonymous && manualFeed.autoGenerateClips && manualFeed.viralitySettings) {
      const clipQuota = await checkClipQuota(user.id, user.subscriptionPlan);
      if (!clipQuota.allowed) {
        console.warn(`[Auto-Gen] Clip quota exceeded for user ${user.id}. Skipping.`);
      } else {
        try {
          const rawSettings = manualFeed.viralitySettings as Partial<ViralitySettingsValue>;
          const settings = mergeViralitySettings(rawSettings);
          const strictnessConfig = getStrictnessConfig(settings.strictnessPreset);

          const queue = getClipGenerationQueue();
          await queue.add(
            'clip-generation',
            {
              feedVideoId: newVideo.id,
              userId: user.id,
              aspectRatio: '9:16',
              scoringMode: settings.scoringMode || 'hybrid',
              includeAudio: settings.includeAudio || false,
              saferClips: settings.saferClips ?? true,
              targetPlatform: settings.targetPlatform || 'reels',
              contentStyle: settings.contentStyle || 'auto',
              llmProvider: settings.llmProvider,
              ...strictnessConfig,
            },
            { jobId: newVideo.id, removeOnComplete: true, removeOnFail: true }
          );
          console.log(`[Auto-Gen] Enqueued job for video ${newVideo.id}`);
        } catch (err) {
          console.error('[Auto-Gen] Failed to enqueue job:', err);
        }
      }
    }

    return withAnonCookie(NextResponse.json(newVideo), newAnonId);
  } catch (error) {
    console.error('Upload completion error:', error);
    return withAnonCookie(
      NextResponse.json({ error: 'Failed to register upload' }, { status: 500 }),
      newAnonId
    );
  }
}
