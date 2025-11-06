import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import fetch from 'node-fetch';
import { prisma } from '@shared/lib/prisma';

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
      const res = await fetch('http://backend:3001/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript })
      });

      const data = await res.json();

      if (!data.title || !data.description) {
        throw new Error('Missing title or description from Ollama response');
      }

      await prisma.video.update({
        where: { id: videoId },
        data: {
          videoTitle: data.title,
          sharedDescription: data.description,
        }
      });

      console.log(`✅ Metadata updated for video ${videoId}`);
    } catch (err: any) {
      console.error(`❌ Failed to generate metadata for video ${videoId}:`, err.message);
      throw err; // Mark job as failed → retry if attempts set
    }
  },
  { connection: redis }
);

