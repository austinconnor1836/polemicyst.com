const dotenv = require('dotenv');
dotenv.config();
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

import { Worker } from 'bullmq';
import { downloadQueue } from './queues/downloadQueue';
import { redisConnection } from './queues/redisConnection';
import { prisma } from '@shared/lib/prisma';
import { downloadAndUploadToS3 } from '@shared/util/downloadAndUploadToS3';
import { queueTranscriptionJob } from '@shared/queues';

type DownloadJob = {
  feedVideoId: string;
  url: string;
  title?: string;
  feedId?: string;
  userId?: string;
};

new Worker<DownloadJob>(
  downloadQueue.name,
  async (job) => {
    const { feedVideoId, url, title } = job.data;

    const feedVideo = await prisma.feedVideo.findUnique({ where: { id: feedVideoId } });
    if (!feedVideo) {
      console.warn(`feed-download: FeedVideo ${feedVideoId} missing, skipping`);
      return;
    }

    try {
      const s3Url = await downloadAndUploadToS3(url, feedVideo.videoId || feedVideoId);

      await prisma.feedVideo.update({
        where: { id: feedVideoId },
        data: {
          s3Url,
          status: 'ready',
        },
      });

      await queueTranscriptionJob({
        feedVideoId,
        sourceUrl: s3Url,
        title: title || feedVideo.title,
      });

      console.log(`feed-download: downloaded ${feedVideoId} -> ${s3Url}`);
    } catch (err) {
      console.error(`feed-download error for ${feedVideoId}:`, err);
      await prisma.feedVideo.update({
        where: { id: feedVideoId },
        data: { status: 'failed' },
      });
      throw err;
    }
  },
  { connection: redisConnection as any }
);

console.log('feed-download worker up');
