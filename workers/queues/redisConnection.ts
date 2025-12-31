// backend/queues/redisConnection.ts
import { RedisOptions } from 'bullmq';

export const redisConnection: RedisOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: 6379,
};
