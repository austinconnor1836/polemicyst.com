import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { VideoFeed } from '@prisma/client';

const execPromise = promisify(exec);
const UPLOADS_DIR = '/app/uploads';

interface NewVideo {
  id: string;
  title: string;
  url: string;
}

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
