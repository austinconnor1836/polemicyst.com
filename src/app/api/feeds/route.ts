// src/app/api/feeds/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { checkFeedQuota, checkAutoGenerateAccess } from '@/lib/plans';

function detectSourceType(sourceUrlRaw: string): 'youtube' | 'cspan' {
  const trimmed = (sourceUrlRaw || '').trim();
  let lower = trimmed.toLowerCase();

  // Accept URLs missing protocol (e.g. "www.youtube.com/@handle")
  if (lower && !lower.startsWith('http://') && !lower.startsWith('https://')) {
    lower = `https://${lower}`;
  }

  // Use a permissive check (we don't want a strict URL parse to block common copy/paste).
  if (
    lower.includes('youtube.com') ||
    lower.includes('youtu.be') ||
    lower.includes('youtube-nocookie.com') ||
    lower.includes('m.youtube.com')
  ) {
    return 'youtube';
  }

  if (lower.includes('c-span.org') || lower.includes('cspan')) {
    return 'cspan';
  }

  throw new Error('UNSUPPORTED_SOURCE');
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const feeds = await prisma.videoFeed.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(feeds);
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check feed quota before proceeding
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
  const { name, sourceUrl, pollingInterval, autoGenerateClips, viralitySettings } = data;

  // Enforce auto-generate access
  if (autoGenerateClips) {
    const autoAccess = checkAutoGenerateAccess(user.subscriptionPlan);
    if (!autoAccess.allowed) {
      return NextResponse.json(
        { error: autoAccess.message, code: 'PLAN_RESTRICTED' },
        { status: 403 }
      );
    }
  }

  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }
  if (!sourceUrl || !String(sourceUrl).trim()) {
    return NextResponse.json({ error: 'Source URL is required' }, { status: 400 });
  }

  let sourceType: 'youtube' | 'cspan';
  try {
    sourceType = detectSourceType(String(sourceUrl));
  } catch (e) {
    return NextResponse.json(
      {
        error:
          'Unsupported feed URL. Currently supported sources are YouTube and C-SPAN. Please paste a channel/playlist URL.',
      },
      { status: 400 }
    );
  }

  const intervalNum = Number(pollingInterval);
  const safePollingInterval = Number.isFinite(intervalNum)
    ? Math.max(1, Math.floor(intervalNum))
    : 60;

  const newFeed = await prisma.videoFeed.create({
    data: {
      name: String(name).trim(),
      sourceUrl: String(sourceUrl).trim(),
      pollingInterval: safePollingInterval,
      sourceType,
      userId: user.id, // ✅ required
      autoGenerateClips: !!autoGenerateClips,
      viralitySettings: viralitySettings ?? undefined,
    },
  });

  // Pull the latest video from the source and queue a download job
  try {
    let newVideo: { id: string; title: string; url: string; thumbnailUrl?: string | null } | null =
      null;

    if (sourceType === 'youtube') {
      const { pollYouTubeFeed } = await import('@shared/util/youtube');
      newVideo = await pollYouTubeFeed(newFeed);
    } else if (sourceType === 'cspan') {
      const { pollCspanFeed } = await import('@shared/util/cspan');
      newVideo = await pollCspanFeed(newFeed);
    }

    if (newVideo) {
      const thumbnailUrl =
        newVideo.thumbnailUrl ??
        (sourceType === 'youtube'
          ? `https://img.youtube.com/vi/${newVideo.id}/maxresdefault.jpg`
          : null);

      const feedVideo = await prisma.feedVideo.create({
        data: {
          feedId: newFeed.id,
          videoId: newVideo.id,
          title: newVideo.title,
          thumbnailUrl,
          s3Url: '',
          status: 'pending',
          userId: user.id,
        },
      });

      await prisma.videoFeed.update({
        where: { id: newFeed.id },
        data: { lastVideoId: newVideo.id },
      });

      const { queueFeedDownloadJob } = await import('@shared/queues');
      await queueFeedDownloadJob({
        feedVideoId: feedVideo.id,
        url: newVideo.url,
        title: newVideo.title,
        feedId: newFeed.id,
        userId: user.id,
      });
    }
  } catch (err) {
    // Non-blocking: feed is created even if initial pull fails
    console.error('Initial video pull failed (non-blocking):', err);
  }

  return NextResponse.json(newFeed);
}
