import { prisma } from '@shared/lib/prisma';
import { queueFeedDownloadJob, queueTranscriptionJob } from '@shared/queues';

export function detectSourceType(sourceUrlRaw: string): 'youtube' | 'cspan' {
  const trimmed = (sourceUrlRaw || '').trim();
  let lower = trimmed.toLowerCase();

  if (lower && !lower.startsWith('http://') && !lower.startsWith('https://')) {
    lower = `https://${lower}`;
  }

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

export async function getUserFeeds(userId: string) {
  return prisma.videoFeed.findMany({
    where: { userId, sourceType: { not: 'manual' } },
    orderBy: { createdAt: 'desc' },
  });
}

interface CreateFeedInput {
  name: string;
  sourceUrl: string;
  pollingInterval?: number;
  autoGenerateClips?: boolean;
  viralitySettings?: Record<string, unknown>;
}

export async function createFeed(userId: string, input: CreateFeedInput) {
  const sourceType = detectSourceType(input.sourceUrl);

  const intervalNum = Number(input.pollingInterval);
  const safePollingInterval = Number.isFinite(intervalNum)
    ? Math.max(1, Math.floor(intervalNum))
    : 60;

  const newFeed = await prisma.videoFeed.create({
    data: {
      name: String(input.name).trim(),
      sourceUrl: String(input.sourceUrl).trim(),
      pollingInterval: safePollingInterval,
      sourceType,
      userId,
      autoGenerateClips: !!input.autoGenerateClips,
      viralitySettings: input.viralitySettings ?? undefined,
    },
  });

  try {
    await pullInitialVideo(newFeed, userId, sourceType);
  } catch (err) {
    console.error('Initial video pull failed (non-blocking):', err);
  }

  return newFeed;
}

async function pullInitialVideo(
  feed: { id: string },
  userId: string,
  sourceType: 'youtube' | 'cspan'
) {
  let newVideo: { id: string; title: string; url: string; thumbnailUrl?: string | null } | null =
    null;

  if (sourceType === 'youtube') {
    const { pollYouTubeFeed } = await import('@shared/util/youtube');
    newVideo = await pollYouTubeFeed(feed as any);
  } else if (sourceType === 'cspan') {
    const { pollCspanFeed } = await import('@shared/util/cspan');
    newVideo = await pollCspanFeed(feed as any);
  }

  if (newVideo) {
    const thumbnailUrl =
      newVideo.thumbnailUrl ??
      (sourceType === 'youtube'
        ? `https://img.youtube.com/vi/${newVideo.id}/maxresdefault.jpg`
        : null);

    const feedVideo = await prisma.feedVideo.create({
      data: {
        feedId: feed.id,
        videoId: newVideo.id,
        title: newVideo.title,
        thumbnailUrl,
        s3Url: newVideo.url,
        status: 'pending',
        userId,
      },
    });

    await prisma.videoFeed.update({
      where: { id: feed.id },
      data: { lastVideoId: newVideo.id },
    });

    await queueFeedDownloadJob({
      feedVideoId: feedVideo.id,
      url: newVideo.url,
      title: newVideo.title,
      feedId: feed.id,
      userId,
    });

    // For YouTube feeds, enqueue transcription in parallel with download.
    // YouTube captions resolve in ~100ms while the download takes minutes.
    if (sourceType === 'youtube') {
      await queueTranscriptionJob({ feedVideoId: feedVideo.id });
    }
  }
}
