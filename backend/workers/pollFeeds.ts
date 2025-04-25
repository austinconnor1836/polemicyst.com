import prisma from '../../lib/prisma';
import { getNewVideoFromFeed } from '../lib/feedScraper';
import { queueTranscriptionJob } from '../queues/transcriptionQueue';

export async function pollFeeds() {
  const feeds = await prisma.videoFeed.findMany();

  for (const feed of feeds) {
    try {
      console.log(`[${new Date().toISOString()}] Checking feed: ${feed.name}`);

      const newVideo = await getNewVideoFromFeed(feed.sourceUrl, feed.lastVideoId);

      if (!newVideo) {
        console.log(`No new video found for feed: ${feed.name}`);
        continue;
      }

      console.log(`New video found: ${newVideo.id} — ${newVideo.url}`);

      await prisma.videoFeed.update({
        where: { id: feed.id },
        data: {
          lastVideoId: newVideo.id,
          lastCheckedAt: new Date(),
        },
      });

      await queueTranscriptionJob({
        sourceUrl: newVideo.url,
        feedId: feed.id,
        title: newVideo.title,
      });

    } catch (err) {
      console.error(`Error polling feed ${feed.name}:`, err);
    }
  }
}
