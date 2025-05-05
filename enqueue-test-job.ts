import { Queue } from 'bullmq';

const run = async () => {
  const queue = new Queue('clip-jobs', {
    connection: {
      host: 'localhost',
      port: 6379,
    },
  });

  await queue.add('generateClip', {
    videoId: 'abc123',
    s3Url: 'https://example.com/video.mp4',
  });

  console.log('✅ Enqueued clip job!');
};

run();
