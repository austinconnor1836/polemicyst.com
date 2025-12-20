import { Queue } from 'bullmq';

const run = async () => {
  const queue = new Queue('clip-generation', {
    connection: {
      host: 'localhost',
      port: 6379,
    },
  });

  const feedVideoId = process.env.FEED_VIDEO_ID;
  const userId = process.env.USER_ID;

  if (!feedVideoId || !userId) {
    throw new Error('Set FEED_VIDEO_ID and USER_ID env vars before running this script.');
  }

  await queue.add('generate', {
    feedVideoId,
    userId,
    aspectRatio: process.env.ASPECT_RATIO || '9:16',
    scoringMode: process.env.SCORING_MODE || 'hybrid',
    includeAudio: process.env.INCLUDE_AUDIO ? process.env.INCLUDE_AUDIO === 'true' : true,
    saferClips: process.env.SAFER_CLIPS ? process.env.SAFER_CLIPS === 'true' : true,
    targetPlatform: process.env.TARGET_PLATFORM || 'reels',
    contentStyle: process.env.CONTENT_STYLE || 'auto',
    minCandidates: process.env.MIN_CANDIDATES ? Number(process.env.MIN_CANDIDATES) : 3,
    maxCandidates: process.env.MAX_CANDIDATES ? Number(process.env.MAX_CANDIDATES) : 20,
    minScore: process.env.MIN_SCORE ? Number(process.env.MIN_SCORE) : 6.5,
    percentile: process.env.PERCENTILE ? Number(process.env.PERCENTILE) : 0.85,
    maxGeminiCandidates: process.env.MAX_GEMINI_CANDIDATES ? Number(process.env.MAX_GEMINI_CANDIDATES) : 24,
  });

  console.log('✅ Enqueued clip-generation job (candidates)!');
  await queue.close();
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
