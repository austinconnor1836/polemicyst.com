import { prisma } from './lib/prisma';
import { queueTranscriptionJob } from './queues/transcriptionQueue';
import { pollYouTubeFeed } from './poller/sources/youtube';
import { pollCspanFeed } from './poller/sources/cspan';
import { downloadAndUploadToS3 } from './downloadAndUploadToS3'; // your streaming S3 uploader

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

      // Upload video directly to S3
      const s3Url = await downloadAndUploadToS3(newVideo.url, newVideo.id);

      // Store in FeedVideo table
      await prisma.feedVideo.create({
        data: {
          feedId: feed.id,
          videoId: newVideo.id,
          title: newVideo.title,
          s3Url,
          userId: feed.userId
        }
      });

      // Update last seen video ID
      await prisma.videoFeed.update({
        where: { id: feed.id },
        data: { lastVideoId: newVideo.id },
      });

      // Queue transcription
      await queueTranscriptionJob({
        sourceUrl: s3Url,
        feedId: feed.id,
        title: newVideo.title,
      });

      console.log(`Queued transcription and stored video: ${newVideo.title}`);

    } catch (err) {
      console.error(`Error polling feed ${feed.name}:`, err);
    }
  }
}
