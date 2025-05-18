import { Worker } from 'bullmq';
import Redis from 'ioredis';
import fetch from 'node-fetch';

const redis = new Redis({
  host: 'redis',
  port: 6379,
  maxRetriesPerRequest: null,
});

// Non-blocking worker
new Worker(
  'clip-generation',
  async (job) => {
    const { feedVideoId, userId } = job.data;
    console.log(`📥 Enqueuing clip-generation for ${feedVideoId}`);

    // Fire-and-forget
    fetch('http://backend:3001/api/clip-generation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedVideoId, userId }),
    })
      .then(() => {
        console.log(`🚀 Triggered backend clip-generation for ${feedVideoId}`);
      })
      .catch((err) => {
        console.error(`❌ Failed to trigger backend clip-generation: ${err.message}`);
      });

    // Don't wait for fetch to complete — exit immediately
  },
  { connection: redis }
);
