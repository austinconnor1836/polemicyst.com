import { Worker } from 'bullmq';
import Redis from 'ioredis';
import fetch from 'node-fetch';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: 6379,
  maxRetriesPerRequest: null,
});

// Non-blocking worker
new Worker(
  'clip-generation',
  async (job) => {
    const { feedVideoId, userId, aspectRatio } = job.data;
    console.log(`📥 Enqueuing clip-generation for ${feedVideoId}`);

    // Fire-and-forget
    fetch('http://backend:3001/api/clip-generation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedVideoId, userId, aspectRatio }),
    })
      .then(() => {
        console.log(`🚀 Triggered backend clip-generation for ${feedVideoId}`);
      })
      .catch((err: unknown) => {
        if (err instanceof Error) {
          console.error(`❌ Failed to trigger backend clip-generation: ${err.message}`);
        } else {
          console.error('❌ Failed to trigger backend clip-generation:', err);
        }
      });

    // Don't wait for fetch to complete — exit immediately
  },
  { connection: redis }
);
