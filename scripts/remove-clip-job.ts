import { Queue } from 'bullmq';
import 'dotenv/config';

async function main() {
  const jobId = process.env.JOB_ID;
  if (!jobId) {
    throw new Error('Provide JOB_ID env var (typically a feedVideoId)');
  }

  const queue = new Queue('clip-generation', {
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT || 6379),
    },
  });

  try {
    const job = await queue.getJob(jobId);
    if (!job) {
      console.log(`No job found with ID ${jobId}`);
      return;
    }

    await job.remove();
    console.log(`Removed job ${jobId} from clip-generation queue`);
  } finally {
    await queue.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
