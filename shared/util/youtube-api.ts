import { google } from 'googleapis';
import type { VideoFeed } from '@prisma/client';
export type YouTubeChannel = {
  id: string;
  title: string;
  thumbnail: string;
  subscriberCount?: string;
};

/**
 * List all YouTube channels owned by the authenticated user.
 */
export async function listUserChannels(accessToken: string): Promise<YouTubeChannel[]> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const youtube = google.youtube({ version: 'v3', auth });

  const res = await youtube.channels.list({
    part: ['snippet', 'statistics'],
    mine: true,
    maxResults: 50,
  });

  const channels = res.data.items ?? [];

  return channels.map((ch) => ({
    id: ch.id!,
    title: ch.snippet?.title ?? '',
    thumbnail: ch.snippet?.thumbnails?.default?.url ?? '',
    subscriberCount: ch.statistics?.subscriberCount ?? undefined,
  }));
}

/**
 * Poll a YouTube OAuth feed for the latest video using the Data API.
 * Uses playlistItems.list (1 quota unit) instead of search.list (100 units).
 */
export async function pollYouTubeOAuthFeed(
  feed: VideoFeed,
  accessToken: string
): Promise<{ id: string; title: string; url: string; thumbnailUrl?: string | null } | null> {
  if (!feed.youtubeChannelId) {
    console.warn(`[youtube-api] Feed ${feed.id} has no youtubeChannelId`);
    return null;
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const youtube = google.youtube({ version: 'v3', auth });

  // Get the uploads playlist ID for this channel
  const channelRes = await youtube.channels.list({
    part: ['contentDetails'],
    id: [feed.youtubeChannelId],
  });

  const uploadsPlaylistId = channelRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

  if (!uploadsPlaylistId) {
    console.warn(`[youtube-api] No uploads playlist found for channel ${feed.youtubeChannelId}`);
    return null;
  }

  // Get the most recent video from the uploads playlist
  const playlistRes = await youtube.playlistItems.list({
    part: ['snippet'],
    playlistId: uploadsPlaylistId,
    maxResults: 1,
  });

  const item = playlistRes.data.items?.[0];
  if (!item?.snippet?.resourceId?.videoId) {
    return null;
  }

  const videoId = item.snippet.resourceId.videoId;
  const title = item.snippet.title ?? 'Untitled';
  const thumbnailUrl =
    item.snippet.thumbnails?.maxres?.url ??
    item.snippet.thumbnails?.high?.url ??
    item.snippet.thumbnails?.default?.url ??
    null;

  // Check if this is the same video we already have
  if (feed.lastVideoId === videoId) {
    return null;
  }

  return {
    id: videoId,
    title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnailUrl,
  };
}
