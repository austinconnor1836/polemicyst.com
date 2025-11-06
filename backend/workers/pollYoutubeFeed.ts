import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';
import { VideoFeed } from '@prisma/client';

export async function pollYouTubeFeed(feed: VideoFeed) {
  const channelId = extractChannelId(feed.sourceUrl);

  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  const xml = await res.text();
  const result = await parseStringPromise(xml);
  const latest = result.feed.entry?.[0];

  if (!latest) return null;

  const videoId = latest['yt:videoId'][0];
  const title = latest.title[0];
  const url = latest.link[0].$.href;

  if (videoId === feed.lastVideoId) return null;

  return {
    id: videoId,
    title,
    url,
  };
}

function extractChannelId(url: string): string {
  // Support either full channel URL or just channel ID
  const match = url.match(/channel\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return url; // Assume it's a raw channel ID
}
