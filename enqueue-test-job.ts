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
  });

  console.log('✅ Enqueued clip-generation job (candidates)!');
};

run();
