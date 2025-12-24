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
};

export type FeedVideo = {
  id: string;
  feedId: string;
  title: string;
  thumbnailUrl?: string | null;
  s3Url: string;
  createdAt?: string;
  feed?: { name: string };
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
