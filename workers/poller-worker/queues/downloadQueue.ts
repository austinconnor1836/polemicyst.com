import { Queue } from 'bullmq';
import { redisConnection } from './redisConnection';

export const downloadQueue = new Queue('feed-download', {
  connection: redisConnection as any,
});
