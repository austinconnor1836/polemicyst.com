// backend/queues/redisConnection.ts
import { RedisOptions } from 'bullmq';

export const redisConnection: RedisOptions = {
  host: 'redis',  // 👈 The service name in docker-compose.yml
  port: 6379,
};
