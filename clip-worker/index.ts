import { Worker } from 'bullmq';

const connection = {
  host: 'redis',
  port: 6379,
};

const worker = new Worker(
  'clip-jobs',
  async (job) => {
    console.log('👷 Processing clip job:', job.data);
  },
  { connection }
);
