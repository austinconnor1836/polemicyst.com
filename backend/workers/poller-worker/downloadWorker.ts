import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

import { Worker } from 'bullmq';
import { downloadQueue } from './queues/downloadQueue';
import { redisConnection } from './queues/redisConnection';
import { prisma } from './lib/prisma';
import { downloadAndUploadToS3 } from './downloadAndUploadToS3';
import { queueTranscriptionJob } from './queues/transcriptionQueue';
import { Queue } from 'bullmq';

const clipGenerationQueue = new Queue('clip-generation', { connection: redisConnection });

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
    const { feedVideoId, url, title, feedId } = job.data;

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
        sourceUrl: s3Url,
        title: title || feedVideo.title,
        feedId: feedId || feedVideo.feedId,
      });

      // Auto-trigger clip generation if feed is configured
      const feed = await prisma.videoFeed.findUnique({
        where: { id: feedVideo.feedId },
      });
      if (feed?.autoGenerateClips && feed.viralitySettings) {
        const settings = feed.viralitySettings as any;
        const strictnessPreset = settings.strictnessPreset || 'balanced';
        const strictnessConfig = {
          minScore: 6.5,
          percentile: 0.85,
          minCandidates: 3,
          maxCandidates: 20,
          maxGeminiCandidates: 24,
          ...(strictnessPreset === 'strict'
            ? {
                minScore: 7.0,
                percentile: 0.9,
                minCandidates: 3,
                maxCandidates: 12,
                maxGeminiCandidates: 18,
              }
            : strictnessPreset === 'loose'
              ? {
                  minScore: 6.0,
                  percentile: 0.75,
                  minCandidates: 5,
                  maxCandidates: 24,
                  maxGeminiCandidates: 36,
                }
              : {}),
        };

        await clipGenerationQueue.add(
          'clip-generation',
          {
            feedVideoId,
            userId: feed.userId,
            aspectRatio: '9:16',
            scoringMode: settings.scoringMode || 'hybrid',
            includeAudio: settings.includeAudio || false,
            saferClips: settings.saferClips ?? true,
            targetPlatform: settings.targetPlatform || 'reels',
            contentStyle: settings.contentStyle || 'auto',
            llmProvider: settings.llmProvider,
            ...strictnessConfig,
          },
          { jobId: feedVideoId }
        );
        console.log(`feed-download: auto enqueued clip-generation for ${feedVideoId}`);
      }

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
  { connection: redisConnection }
);

console.log('feed-download worker up');
