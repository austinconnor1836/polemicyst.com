import { prisma } from '@shared/lib/prisma';
import { queueTranscriptionJob } from '@shared/queues';
import { pollYouTubeFeed } from '@shared/util/youtube';
import { pollCspanFeed } from '@shared/util/cspan';
import { downloadAndUploadToS3 } from '@shared/util/downloadAndUploadToS3';

function inferSourceTypeFromUrl(sourceUrlRaw: string): 'youtube' | 'cspan' | null {
  const lower = (sourceUrlRaw || '').trim().toLowerCase();
  if (!lower) return null;

  if (
    lower.includes('youtube.com') ||
    lower.includes('youtu.be') ||
    lower.includes('youtube-nocookie.com') ||
    lower.includes('m.youtube.com')
  ) {
    return 'youtube';
  }
  if (lower.includes('c-span.org') || lower.includes('cspan')) return 'cspan';
  return null;
}

export async function pollFeeds() {
  const now = new Date();
  const feeds = await prisma.videoFeed.findMany();

  for (const feed of feeds) {
    const minutesSinceLastCheck = feed.lastCheckedAt
      ? (now.getTime() - new Date(feed.lastCheckedAt).getTime()) / 60000
      : Infinity;

    if (minutesSinceLastCheck < feed.pollingInterval) continue;

    try {
      console.log(`[${now.toISOString()}] Polling feed: ${feed.name}`);
      let newVideo: {
        id: string;
        title: string;
        url: string;
        thumbnailUrl?: string | null;
      } | null = null;

      const inferred = inferSourceTypeFromUrl(feed.sourceUrl);
      const effectiveSourceType =
        feed.sourceType === 'youtube' || feed.sourceType === 'cspan' ? feed.sourceType : inferred;

      if (!effectiveSourceType) {
        console.warn(
          `Skipping feed "${feed.name}" (id=${feed.id}) due to unsupported sourceType="${feed.sourceType}" and unrecognized sourceUrl="${feed.sourceUrl}"`
        );
        continue;
      }

      // Opportunistically heal old data: if the DB has a legacy/incorrect sourceType, fix it.
      if (effectiveSourceType !== feed.sourceType) {
        await prisma.videoFeed.update({
          where: { id: feed.id },
          data: { sourceType: effectiveSourceType },
        });
        console.log(
          `Updated feed "${feed.name}" (id=${feed.id}) sourceType from "${feed.sourceType}" -> "${effectiveSourceType}"`
        );
      }

      switch (effectiveSourceType) {
        case 'youtube':
          newVideo = await pollYouTubeFeed(feed);
          break;
        case 'cspan':
          newVideo = await pollCspanFeed(feed);
          break;
      }

      // Update lastCheckedAt regardless of whether a new video was found
      await prisma.videoFeed.update({
        where: { id: feed.id },
        data: { lastCheckedAt: now },
      });

      if (!newVideo) {
        console.log(`No new video found for ${feed.name}`);
        continue;
      }

      // Upload video directly to S3
      const s3Url = await downloadAndUploadToS3(newVideo.url, newVideo.id);

      // Store in FeedVideo table
      // Store in FeedVideo table
      const feedVideo = await prisma.feedVideo.create({
        data: {
          feedId: feed.id,
          videoId: newVideo.id,
          title: newVideo.title,
          thumbnailUrl: newVideo.thumbnailUrl,
          s3Url,
          userId: feed.userId,
        },
      });

      // Update last seen video ID
      await prisma.videoFeed.update({
        where: { id: feed.id },
        data: { lastVideoId: newVideo.id },
      });

      // Queue transcription
      await queueTranscriptionJob({
        feedVideoId: feedVideo.id,
        sourceUrl: s3Url,
        title: newVideo.title,
      });

      console.log(`Queued transcription and stored video: ${newVideo.title}`);
    } catch (err) {
      console.error(`Error polling feed ${feed.name}:`, err);
    }
  }
}
