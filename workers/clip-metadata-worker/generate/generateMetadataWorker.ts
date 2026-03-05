import { Worker, Job } from 'bullmq';
import { prisma } from '@shared/lib/prisma';
import { getRedisConnection } from '@shared/queues';
import { generateMetadataWithOllama } from '@shared/lib/metadata-generation';

new Worker(
  'generate-metadata',
  async (job: Job) => {
    const { videoId, transcript } = job.data;

    try {
      // Use shared logic to call Ollama directly
      const { title, description } = await generateMetadataWithOllama(transcript);

      await prisma.video.update({
        where: { id: videoId },
        data: {
          videoTitle: title,
          sharedDescription: description,
        },
      });

      console.log(`✅ Metadata updated for video ${videoId}`);
    } catch (err: any) {
      console.error(`❌ Failed to generate metadata for video ${videoId}:`, err.message);
      throw err; // Mark job as failed → retry if attempts set
    }
  },
  { connection: getRedisConnection() as any }
);
