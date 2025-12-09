import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { VideoFeed } from '@prisma/client';

const execPromise = promisify(exec);

const UPLOADS_DIR = '/app/uploads';  // Inside Docker

interface NewVideo {
  id: string;
  title: string;
  url: string;
}

// Helper to extract C-SPAN video ID
function extractCspanId(url: string): string | null {
  const match = url.match(/\/video\/(\d+)/);
  return match ? match[1] : null;
}

// Polling logic for C-SPAN feed
export async function pollCspanFeed(feed: VideoFeed): Promise<NewVideo | null> {
  // For now: Assume feed.sourceUrl points directly to the latest video
  const id = extractCspanId(feed.sourceUrl);
  if (!id) {
    console.log(`[CSPAN Poller] Could not extract video ID from URL: ${feed.sourceUrl}`);
    return null;
  }

  if (feed.lastVideoId === id) {
    console.log(`[CSPAN Poller] No new video for ${feed.name}`);
    return null;
  }

  const title = `C-SPAN Video ${id}`; // (placeholder: later scrape real title if needed)

  return {
    id,
    title,
    url: feed.sourceUrl,
  };
}

// Download logic for C-SPAN feed
export async function downloadCspanVideo(url: string, id: string): Promise<string> {
  const safeFileName = `${id}.mp4`;
  const outputPath = path.join(UPLOADS_DIR, safeFileName);

  const command = `yt-dlp -o "${outputPath}" "${url}"`;

  console.log(`[CSPAN Downloader] Running: ${command}`);
  await execPromise(command);

  console.log(`[CSPAN Downloader] Downloaded to ${outputPath}`);
  return outputPath;
}
