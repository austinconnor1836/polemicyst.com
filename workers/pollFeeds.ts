import { prisma } from './lib/prisma';
import { queueTranscriptionJob } from './queues/transcriptionQueue';
import { pollYouTubeFeed, downloadYouTubeVideo } from './poller/sources/youtube';
import { pollCspanFeed, downloadCspanVideo } from './poller/sources/cspan';

interface NewVideo {
  id: string;
  title: string;
  url: string;
}

export async function pollFeeds() {
  const feeds = await prisma.videoFeed.findMany();

  for (const feed of feeds) {
    try {
      console.log(`[${new Date().toISOString()}] Checking feed: ${feed.name}`);

      let newVideo: NewVideo | null = null;

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

      let downloadedPath = '';

      switch (feed.sourceType) {
        case 'youtube':
          downloadedPath = await downloadYouTubeVideo(newVideo.url, newVideo.id);
          break;
        case 'cspan':
          downloadedPath = await downloadCspanVideo(newVideo.url, newVideo.id);
          break;
      }

      await queueTranscriptionJob({
        sourceUrl: downloadedPath,
        feedId: feed.id,
        title: newVideo.title,
      });

    } catch (err) {
      console.error(`Error polling feed ${feed.name}:`, err);
    }
  }
}
