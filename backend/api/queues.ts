import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const queueConnection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: 6379,
});

export const queue = new Queue('generate-metadata', {
  connection: queueConnection,
});