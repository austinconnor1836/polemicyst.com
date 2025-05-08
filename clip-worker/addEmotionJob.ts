import { Queue } from 'bullmq';

const connection = {
  host: 'redis',
  port: 6379,
};

const emotionQueue = new Queue('emotion-jobs', { connection });

async function addEmotionJob(audioPath: string) {
  await emotionQueue.add('analyze-emotion', { audioPath });
  console.log(`🚀 Added emotion job for: ${audioPath}`);
}

addEmotionJob('/path/to/audio.wav');
