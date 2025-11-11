import { VideoFeed } from '@prisma/client';
import { pollYouTubeFeed } from './youtube';
import { pollCspanFeed } from './cspan';
import { downloadAndUploadToS3 } from './downloadAndUploadToS3';

/**
 * Downloads the most recent video for a feed and uploads it to S3.
 * Returns the FeedVideo-like object or null if nothing downloaded.
 */
export async function downloadLatestFeedVideo(feed: VideoFeed, userId: string) {
  let latest: { id: string; title: string; url: string } | null = null;
  switch (feed.sourceType) {
    case 'youtube':
      latest = await pollYouTubeFeed(feed);
      break;
    case 'cspan':
      latest = await pollCspanFeed(feed);
      break;
    default:
      throw new Error(`Unsupported sourceType: ${feed.sourceType}`);
  }
  if (!latest) return null;
  const s3Url = await downloadAndUploadToS3(latest.url, latest.id);
  return {
    feedId: feed.id,
    videoId: latest.id,
    title: latest.title,
    s3Url,
    userId,
  };
}
