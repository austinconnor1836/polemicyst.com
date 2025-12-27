import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../auth';
import { prisma } from '@shared/lib/prisma';
import { randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import {
  getStrictnessConfig,
  mergeViralitySettings,
  type ViralitySettingsValue,
} from '@shared/virality';

const redisHost = process.env.REDIS_HOST || 'localhost';
const redis = new Redis({
  host: redisHost,
  port: 6379,
  maxRetriesPerRequest: null,
});

const clipGenerationQueue = new Queue('clip-generation', { connection: redis });

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
    const { key, filename } = await req.json();

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
          pollingInterval: 0, // No polling for manual uploads
        },
      });
    }

    // 2. Create the FeedVideo record
    // We use the S3 URL format consistent with the rest of the app
    const s3Url = `https://clips-genie-uploads.s3.us-east-2.amazonaws.com/${key}`;

    const newVideo = await prisma.feedVideo.create({
      data: {
        feedId: manualFeed.id,
        userId: user.id,
        videoId: randomUUID(), // Internal ID
        title: filename || 'Untitled Upload',
        s3Url: s3Url,
      },
    });

    // 3. Auto-trigger clip generation if enabled
    if (manualFeed.autoGenerateClips && manualFeed.viralitySettings) {
      try {
        const rawSettings = manualFeed.viralitySettings as Partial<ViralitySettingsValue>;
        const settings = mergeViralitySettings(rawSettings);
        const strictnessConfig = getStrictnessConfig(settings.strictnessPreset);

        await clipGenerationQueue.add(
          'clip-generation',
          {
            feedVideoId: newVideo.id,
            userId: user.id,
            aspectRatio: '9:16', // Default for auto-gen, or could be stored in settings
            scoringMode: settings.scoringMode || 'hybrid',
            includeAudio: settings.includeAudio || false,
            saferClips: settings.saferClips ?? true,
            targetPlatform: settings.targetPlatform || 'reels',
            contentStyle: settings.contentStyle || 'auto',
            llmProvider: settings.llmProvider,
            ...strictnessConfig,
          },
          { jobId: newVideo.id }
        );
        console.log(`[Auto-Gen] Enqueued job for video ${newVideo.id}`);
      } catch (err) {
        console.error('[Auto-Gen] Failed to enqueue job:', err);
        // Don't fail the request, just log error
      }
    }

    return NextResponse.json(newVideo);
  } catch (error) {
    console.error('Upload completion error:', error);
    return NextResponse.json({ error: 'Failed to register upload' }, { status: 500 });
  }
}
