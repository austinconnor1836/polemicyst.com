import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const queueConnection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: 6379,
});

/**
 * Legacy export used by existing code paths that enqueue metadata generation jobs.
 * Prefer using the explicitly named queues below.
 */
export const queue = new Queue('generate-metadata', {
  connection: queueConnection,
});

export const generateMetadataQueue = queue;

/**
 * Queue consumed by `polemicyst.com/clip-worker/index.ts`
 * (which runs in the `clip-worker` service in docker-compose).
 *
 * Jobs should include: { feedVideoId, userId, aspectRatio? }
 */
export const clipGenerationQueue = new Queue('clip-generation', {
  connection: queueConnection,
});