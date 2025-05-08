import { Worker, Queue } from 'bullmq';
import { exec } from 'child_process';
import util from 'util';

const connection = {
  host: 'redis',
  port: 6379,
};

const execPromise = util.promisify(exec);
const slicingQueue = new Queue('slicing-jobs', { connection });

const worker = new Worker(
  'emotion-jobs',
  async (job) => {
    const { audioPath } = job.data;
    console.log('🔍 Analyzing emotion for:', audioPath);

    try {
      const { stdout } = await execPromise(`python3 /app/emotionAnalysis.py ${audioPath}`);
      const emotions = JSON.parse(stdout);

      // Extract the highest scoring emotion
      const topEmotion = emotions[0];
      console.log('🧠 Emotion Analysis Result:', topEmotion);

      // Queue the slicing job with emotion data
      await slicingQueue.add('slice-video', { audioPath, topEmotion });
    } catch (error) {
      console.error('❌ Error during emotion analysis:', error);
    }
  },
  { connection }
);

console.log('Emotion Worker is running...');
