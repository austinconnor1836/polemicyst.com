import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { prisma } from '@shared/lib/prisma';
import { generateMetadataWithOllama } from '@shared/lib/metadata-generation';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: 6379,
  maxRetriesPerRequest: null,
});

new Worker(
  'generate-metadata',
  async (job: Job) => {
    const { videoId, transcript } = job.data;

    try {
      const { title, description } = await generateMetadataWithOllama(transcript);

      await prisma.video.update({
        where: { id: videoId },
        data: {
          videoTitle: title,
          sharedDescription: description,
        },
      });

      console.log(`✅ Metadata updated for video ${videoId}`);
    } catch (err: any) {
      console.error(`❌ Failed to generate metadata for video ${videoId}:`, err.message);
      throw err;
    }
  },
  { connection: redis as any }
);
