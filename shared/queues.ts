// import { VideoFeed } from '@prisma/client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

const redis: Redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: 6379,
  maxRetriesPerRequest: null,
});

export const videoDownloadQueue = new Queue('video-download', { connection: redis as any });

export const transcriptionQueue = new Queue('transcription', {
  connection: redis as any,
});

export interface DownloadJob {
  feedId: string;
  videoId: string;
  sourceUrl: string;
  userId: string;
  title: string;
}

export function queueVideoDownloadJob(data: DownloadJob) {
  return videoDownloadQueue.add('download', data, {
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
  return transcriptionQueue.add('transcribe', data, {
    removeOnComplete: true,
    removeOnFail: true,
  });
}
