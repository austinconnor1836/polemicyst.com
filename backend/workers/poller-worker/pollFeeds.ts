import { prisma } from '@shared/lib/prisma';
import { queueTranscriptionJob, queueVideoDownloadJob } from '@shared/queues';
import { pollYouTubeFeed } from '@shared/util/youtube';
import { pollCspanFeed } from '@shared/util/cspan';

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
      let newVideo: { id: string; title: string; url: string } | null = null;

      switch (feed.sourceType) {
        case 'youtube':
          newVideo = await pollYouTubeFeed(feed);
          break;
        case 'cspan':
          newVideo = await pollCspanFeed(feed);
          break;
        default:
          console.warn(`Unknown sourceType: ${feed.sourceType}`);
          continue;
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

      // Only queue if new video is different from last processed
      if (feed.lastVideoId === newVideo.id) {
        console.log(`Latest video (${newVideo.id}) already processed for ${feed.name}`);
        continue;
      }

      // Pass new video info to the queue job
      await queueVideoDownloadJob({
        feedId: feed.id,
        videoId: newVideo.id,
        sourceUrl: newVideo.url,
        userId: feed.userId,
        title: newVideo.title,
      });
      console.log(`Queued video download for: ${newVideo.title}`);

    } catch (err) {
      console.error(`Error polling feed ${feed.name}:`, err);
    }
  }
}
