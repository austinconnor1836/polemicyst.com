import { Queue } from 'bullmq';
import 'dotenv/config';

async function main() {
  const queue = new Queue('clip-generation', {
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT || 6379),
    },
  });

  try {
    const counts = await queue.getJobCounts('waiting', 'active', 'failed', 'delayed');
    console.log(counts);
    const waiting = await queue.getJobs(['waiting'], 0, 20);
    waiting.forEach((job) => {
      console.log(`waiting: ${job.id}`);
    });
    const active = await queue.getJobs(['active'], 0, 20);
    active.forEach((job) => {
      console.log(`active: ${job.id}`);
    });
  } finally {
    await queue.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
