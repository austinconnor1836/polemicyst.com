import { Worker } from 'bullmq';
import Redis from 'ioredis';
import fetch from 'node-fetch';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: 6379,
  maxRetriesPerRequest: null,
});

const backendBaseUrl = (process.env.BACKEND_BASE_URL || 'http://backend:3001').replace(/\/+$/, '');

// Non-blocking worker
new Worker(
  'clip-generation',
  async (job) => {
    const {
      feedVideoId,
      userId,
      aspectRatio,
      scoringMode,
      includeAudio,
      saferClips,
      targetPlatform,
      contentStyle,
      minCandidates,
      maxCandidates,
      minScore,
      percentile,
      maxGeminiCandidates,
    } = job.data;
    console.log(`📥 Processing clip-generation job (candidates) for ${feedVideoId}`);

    // Fire-and-forget
    fetch(`${backendBaseUrl}/api/clip-candidates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feedVideoId,
        userId,
        aspectRatio,
        scoringMode,
        includeAudio,
        saferClips,
        targetPlatform,
        contentStyle,
        minCandidates,
        maxCandidates,
        minScore,
        percentile,
        maxGeminiCandidates,
      }),
    })
      .then(() => {
        console.log(`🚀 Triggered backend clip-candidates for ${feedVideoId}`);
      })
      .catch((err) => {
        console.error(`❌ Failed to trigger backend clip-candidates: ${err.message}`);
      });

    // Don't wait for fetch to complete — exit immediately
  },
  { connection: redis }
);
