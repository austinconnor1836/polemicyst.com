import { FeedVideo } from '@/app/feeds/types';

// Extracts a YouTube video ID from common URL formats (watch, share, shorts, embed).
export function extractYouTubeId(url?: string | null): string | null {
  if (!url) return null;

  const match =
    url.match(
      /(?:youtube\.com\/watch\\?[^#]*[?&]v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{6,})/
    ) ?? url.match(/youtube\.com\/.*[?&]v=([A-Za-z0-9_-]{6,})/);

  return match?.[1] ?? null;
}

export function getFeedVideoThumbnail(video: FeedVideo) {
  const youtubeId =
    extractYouTubeId(video.s3Url) ||
    (video.feed?.sourceType === 'youtube' ? video.videoId || null : null);

  const thumbnailUrl =
    video.thumbnailUrl ||
    (youtubeId ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` : null);

  return { thumbnailUrl, youtubeId };
}

export function getVideoSourceUrl(video: FeedVideo): string | null {
  const youtubeId =
    extractYouTubeId(video.s3Url) ||
    (video.feed?.sourceType === 'youtube' ? video.videoId || null : null);

  if (youtubeId) {
    return `https://www.youtube.com/watch?v=${youtubeId}`;
  }

  return video.s3Url || null;
}
