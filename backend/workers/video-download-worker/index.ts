require('module-alias/register');
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { downloadAndUploadToS3 } from '@shared/util/downloadAndUploadToS3';
import { prisma } from '@shared/lib/prisma';
import { getLatestVideoFromYoutubeFeed } from '@shared/util/youtube';
import { VideoFeed } from '@prisma/client';
import { NewVideo } from '@shared/types';
import { queueTranscriptionJob } from '@shared/queues';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: 6379,
  maxRetriesPerRequest: null,
});

interface DownloadJob {
  feedId: string;
  videoId: string;
  sourceUrl: string;
  userId: string;
  title: string;
}

new Worker(
  'video-download',
  async (job) => {
    const { id: feedId, sourceUrl, userId } = job.data as VideoFeed;
    try {
      const latestVideo: NewVideo = await getLatestVideoFromYoutubeFeed(feedId);

      const s3Url = await downloadAndUploadToS3(sourceUrl, latestVideo?.id ?? null);
      if (s3Url) {
        const feedVideo = await prisma.feedVideo.create({
          data: {
            feedId,
            videoId: latestVideo.id,
            title: latestVideo.title,
            s3Url,
            userId,
          },
        });
        await queueTranscriptionJob({
          feedVideoId: feedVideo.id,
        });
        console.log(`✅ Downloaded, stored, and queued transcription for video ${latestVideo.id} for feed ${feedId}`);
      }
    } catch (err) {
      console.error(`❌ Failed to download/store video for ${feedId}:`, err);
      throw err;
    }
  },
  { connection: redis }
);
