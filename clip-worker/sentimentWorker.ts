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
  'sentiment-jobs',
  async (job) => {
    const { text } = job.data;
    console.log('🔍 Analyzing sentiment for:', text);

    try {
      const { stdout } = await execPromise(`python3 /app/sentimentAnalysis.py "${text}"`);
      const sentiment = JSON.parse(stdout);

      console.log('💬 Sentiment Analysis Result:', sentiment);

      // Queue the slicing job with sentiment data
      await slicingQueue.add('slice-video', { text, sentiment });
    } catch (error) {
      console.error('❌ Error during sentiment analysis:', error);
    }
  },
  { connection }
);

console.log('Sentiment Worker is running...');
