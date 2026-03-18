import { Queue } from 'bullmq';
import Redis from 'ioredis';

let redis: Redis | null = null;
let videoDownloadQueue: Queue | null = null;
let feedDownloadQueue: Queue | null = null;
let transcriptionQueue: Queue | null = null;
let speakerTranscriptionQueue: Queue | null = null;
let clipGenerationQueue: Queue | null = null;
let reactionComposeQueue: Queue | null = null;

export function getRedisConnection() {
  if (redis) return redis;
  redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
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

/** Job shape expected by workers/poller-worker/downloadWorker.ts (queue: feed-download) */
export interface FeedDownloadJob {
  feedVideoId: string;
  url: string;
  title?: string;
  feedId?: string;
  userId?: string;
}

export function getFeedDownloadQueue() {
  if (feedDownloadQueue) return feedDownloadQueue;
  feedDownloadQueue = new Queue('feed-download', { connection: getRedisConnection() as any });
  return feedDownloadQueue;
}

export function queueFeedDownloadJob(data: FeedDownloadJob) {
  return getFeedDownloadQueue().add('download', data, {
    removeOnComplete: true,
    removeOnFail: true,
  });
}

export function getSpeakerTranscriptionQueue() {
  if (speakerTranscriptionQueue) return speakerTranscriptionQueue;
  speakerTranscriptionQueue = new Queue('speaker-transcription', {
    connection: getRedisConnection() as any,
  });
  return speakerTranscriptionQueue;
}

export interface SpeakerTranscriptionJob {
  feedVideoId: string;
  numSpeakers?: number;
}

export function queueSpeakerTranscriptionJob(data: SpeakerTranscriptionJob) {
  return getSpeakerTranscriptionQueue().add('speaker-transcribe', data, {
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
    jobId: data.feedVideoId,
    removeOnComplete: true,
    removeOnFail: true,
  });
}

export function getClipGenerationQueue() {
  if (clipGenerationQueue) return clipGenerationQueue;
  clipGenerationQueue = new Queue('clip-generation', {
    connection: getRedisConnection() as any,
  });
  return clipGenerationQueue;
}

export interface ReactionComposeJob {
  compositionId: string;
  userId: string;
  layouts: ('mobile' | 'landscape')[];
}

export function getReactionComposeQueue() {
  if (reactionComposeQueue) return reactionComposeQueue;
  reactionComposeQueue = new Queue('reaction-compose', {
    connection: getRedisConnection() as any,
  });
  return reactionComposeQueue;
}

export function queueReactionComposeJob(data: ReactionComposeJob) {
  return getReactionComposeQueue().add('reaction-compose', data, {
    jobId: data.compositionId,
    removeOnComplete: true,
    removeOnFail: true,
  });
}
