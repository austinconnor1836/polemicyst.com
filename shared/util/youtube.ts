
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { VideoFeed } from '@prisma/client';
import { prisma } from '@shared/lib/prisma';
import { NewVideo } from '@shared/types';

const execPromise = promisify(exec);
const UPLOADS_DIR = '/app/uploads';

export async function pollYouTubeFeed(feed: VideoFeed): Promise<NewVideo | null> {
  const listCommand = `yt-dlp --flat-playlist --print "%(id)s %(title)s" "${feed.sourceUrl}"`;
  const { stdout } = await execPromise(listCommand);
  
  const lines = stdout.trim().split('\n');

  if (lines.length === 0) {
    console.log(`[YouTube Poller] No videos found for feed: ${feed.name}`);
    return null;
  }

  const [firstLine] = lines;
  const [id, ...titleParts] = firstLine.split(' ');
  const title = titleParts.join(' ');

  if (feed.lastVideoId === id) {
    console.log(`[YouTube Poller] No new video for ${feed.name}`);
    return null;
  }

  return {
    id,
    title,
    url: `https://www.youtube.com/watch?v=${id}`,
  };
}

export async function downloadYouTubeVideo(url: string, id: string): Promise<string> {
  const safeFileName = `${id}.mp4`;
  const outputPath = path.join(UPLOADS_DIR, safeFileName);
  const command = `yt-dlp -o "${outputPath}" "${url}"`;

  console.log(`[YouTube Downloader] Running: ${command}`);
  await execPromise(command);

  console.log(`[YouTube Downloader] Downloaded to ${outputPath}`);
  return outputPath;
}

// Returns latest video info if new, else returns latestVideoId string
export async function getLatestVideoFromYoutubeFeed(feedId: string): Promise<NewVideo> {
  // Get feed from DB
  const feed = await prisma.videoFeed.findUnique({ where: { id: feedId } });
  if (!feed)   throw new Error(`No video feed found for id: ${feedId}`);

  const listCommand = `yt-dlp --flat-playlist --print "%(id)s %(title)s" "${feed.sourceUrl}"`;
  const { stdout } = await execPromise(listCommand);
  const lines = stdout.trim().split('\n');
  if (lines.length === 0) throw new Error(`No video found for id: ${feedId}`);

  const [firstLine] = lines;
  const [id, ...titleParts] = firstLine.split(' ');
  const title = titleParts.join(' ');

  const res = { id, title, url: `https://www.youtube.com/watch?v=${id}` };

  if (feed.lastVideoId === id) {
    // Already up to date, return just the id
    return res;
  }

  // Update DB with new latestVideoId
  await prisma.videoFeed.update({
    where: { id: feedId },
    data: { lastVideoId: id },
  });

  // Optionally, store in FeedVideo table as well
  // await prisma.feedVideo.upsert({
  //   where: { feedId_videoId: { feedId: feed.id, videoId: id } },
  //   update: {},
  //   create: {
  //     feedId: feed.id,
  //     videoId: id,
  //     title,
  //     userId: feed.userId,
  //     s3Url: '', // Not downloaded yet
  //   },
  // });

  return res;
}
