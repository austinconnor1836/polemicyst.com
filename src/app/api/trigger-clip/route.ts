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

const PLAN_CLIP_LIMITS: Record<string, number> = {
  free: 10,
  pro: 200,
  enterprise: -1,
};

const PLAN_ALLOWED_PROVIDERS: Record<string, string[]> = {
  free: ['openai'],
  pro: ['openai', 'anthropic', 'google'],
  enterprise: ['openai', 'anthropic', 'google', 'ollama'],
};

export async function POST(req: NextRequest) {
  try {
    const { feedVideoId, userId, aspectRatio, llmProvider } = await req.json();

    if (!feedVideoId || !userId) {
      return NextResponse.json({ error: 'Missing feedVideoId or userId' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const plan = user.subscriptionPlan || 'free';
    const clipLimit = PLAN_CLIP_LIMITS[plan] ?? PLAN_CLIP_LIMITS.free;
    const allowedProviders = PLAN_ALLOWED_PROVIDERS[plan] ?? PLAN_ALLOWED_PROVIDERS.free;

    if (llmProvider && !allowedProviders.includes(llmProvider)) {
      return NextResponse.json(
        {
          code: 'PLAN_RESTRICTED',
          message: `The "${llmProvider}" provider is not available on the ${plan} plan.`,
          allowedProviders,
          plan,
        },
        { status: 403 },
      );
    }

    if (clipLimit !== -1) {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const clipsThisMonth = await prisma.video.count({
        where: {
          userId,
          sourceVideoId: { not: null },
          createdAt: { gte: startOfMonth },
        },
      });

      if (clipsThisMonth >= clipLimit) {
        return NextResponse.json(
          {
            code: 'QUOTA_EXCEEDED',
            message: `You have used ${clipsThisMonth}/${clipLimit} clips this month on the ${plan} plan. Upgrade to generate more clips.`,
            plan,
            limit: clipLimit,
            usage: clipsThisMonth,
          },
          { status: 403 },
        );
      }
    }

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

