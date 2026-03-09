export type Brand = {
  id: string;
  name: string;
  imageUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
  _count?: { videoFeeds: number };
};

export type VideoFeed = {
  id: string;
  name: string;
  sourceUrl: string;
  sourceType?: string;
  pollingInterval: number;
  lastCheckedAt?: string | null;
  createdAt?: string;
  autoGenerateClips?: boolean;
  viralitySettings?: any;
  youtubeChannelId?: string | null;
  youtubeChannelTitle?: string | null;
  youtubeChannelThumb?: string | null;
  brandId?: string | null;
  brand?: Brand | null;
};

export type YouTubeChannel = {
  id: string;
  title: string;
  thumbnail: string;
  subscriberCount?: string;
};

export type FeedVideo = {
  id: string;
  feedId: string;
  videoId: string;
  title: string;
  thumbnailUrl?: string | null;
  s3Url: string;
  status?: string;
  createdAt?: string;
  feed?: { name: string; sourceType?: string };
  userId?: string;
  aspectRatio?: string;
  clipSourceVideoId?: string | null;
  clipSourceVideo?: {
    id: string;
    videoTitle?: string | null;
    s3Url?: string | null;
    generatedClips?: Array<{
      id: string;
      videoTitle?: string | null;
      s3Url?: string | null;
      createdAt?: string | null;
    }>;
  } | null;
};
