import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { getValidGoogleToken } from '@shared/lib/google-token';
import { pollYouTubeOAuthFeed } from '@shared/util/youtube-api';
import { checkFeedQuota, checkAutoGenerateAccess } from '@/lib/plans';
import { prisma } from '@shared/lib/prisma';
import { queueFeedDownloadJob, queueTranscriptionJob } from '@shared/queues';

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const quota = await checkFeedQuota(user.id, user.subscriptionPlan);
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error: quota.message,
        code: 'QUOTA_EXCEEDED',
        limit: quota.limit,
        usage: quota.currentUsage,
      },
      { status: 403 }
    );
  }

  const data = await req.json();
  const {
    channelId,
    channelTitle,
    channelThumbnail,
    pollingInterval,
    autoGenerateClips,
    viralitySettings,
    brandId,
  } = data;

  if (!channelId || !channelTitle) {
    return NextResponse.json({ error: 'channelId and channelTitle are required' }, { status: 400 });
  }

  if (autoGenerateClips) {
    const autoAccess = checkAutoGenerateAccess(user.subscriptionPlan);
    if (!autoAccess.allowed) {
      return NextResponse.json(
        { error: autoAccess.message, code: 'PLAN_RESTRICTED' },
        { status: 403 }
      );
    }
  }

  const intervalNum = Number(pollingInterval);
  const safePollingInterval = Number.isFinite(intervalNum)
    ? Math.max(1, Math.floor(intervalNum))
    : 60;

  const newFeed = await prisma.videoFeed.create({
    data: {
      name: String(channelTitle).trim(),
      sourceUrl: `https://www.youtube.com/channel/${channelId}`,
      sourceType: 'youtube-oauth',
      pollingInterval: safePollingInterval,
      userId: user.id,
      autoGenerateClips: !!autoGenerateClips,
      viralitySettings: viralitySettings ?? undefined,
      youtubeChannelId: channelId,
      youtubeChannelTitle: channelTitle,
      youtubeChannelThumb: channelThumbnail ?? null,
      ...(brandId && { brandId }),
    },
  });

  // Pull the initial video using YouTube Data API
  try {
    const token = await getValidGoogleToken(user.id);
    if (token) {
      const newVideo = await pollYouTubeOAuthFeed(newFeed, token);
      if (newVideo) {
        const thumbnailUrl =
          newVideo.thumbnailUrl ?? `https://img.youtube.com/vi/${newVideo.id}/maxresdefault.jpg`;

        const feedVideo = await prisma.feedVideo.create({
          data: {
            feedId: newFeed.id,
            videoId: newVideo.id,
            title: newVideo.title,
            thumbnailUrl,
            s3Url: newVideo.url,
            status: 'pending',
            userId: user.id,
          },
        });

        await prisma.videoFeed.update({
          where: { id: newFeed.id },
          data: { lastVideoId: newVideo.id },
        });

        await queueFeedDownloadJob({
          feedVideoId: feedVideo.id,
          url: newVideo.url,
          title: newVideo.title,
          feedId: newFeed.id,
          userId: user.id,
        });

        // Enqueue transcription in parallel (YouTube captions resolve fast)
        await queueTranscriptionJob({ feedVideoId: feedVideo.id });
      }
    }
  } catch (err) {
    console.error('[from-youtube] Initial video pull failed (non-blocking):', err);
  }

  return NextResponse.json(newFeed);
}
