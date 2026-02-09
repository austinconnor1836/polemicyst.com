// import { VideoFeed } from '@prisma/client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

let redis: Redis | null = null;
let videoDownloadQueue: Queue | null = null;
let transcriptionQueue: Queue | null = null;

function getRedisConnection() {
  if (redis) return redis;
  redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: 6379,
    maxRetriesPerRequest: null,
  });
  return redis;
}

export function getVideoDownloadQueue() {
  if (videoDownloadQueue) return videoDownloadQueue;
  videoDownloadQueue = new Queue('video-download', { connection: getRedisConnection() as any });
  return videoDownloadQueue;
}

export function getTranscriptionQueue() {
  if (transcriptionQueue) return transcriptionQueue;
  transcriptionQueue = new Queue('transcription', { connection: getRedisConnection() as any });
  return transcriptionQueue;
}

export interface DownloadJob {
  feedId: string;
  videoId: string;
  sourceUrl: string;
  userId: string;
  title: string;
}

export function queueVideoDownloadJob(data: DownloadJob) {
  return getVideoDownloadQueue().add('download', data, {
    removeOnComplete: true,
    removeOnFail: true,
  });
}

export interface TranscriptionJob {
  feedVideoId: string;
  sourceUrl?: string; // Optional if we download from S3 using ID? But worker expects it.
  title?: string;
}

export function queueTranscriptionJob(data: TranscriptionJob) {
  return getTranscriptionQueue().add('transcribe', data, {
    removeOnComplete: true,
    removeOnFail: true,
  });
}
