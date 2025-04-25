import { Queue } from 'bullmq';
import { redisConnection } from './redisConnection';

export const transcriptionQueue = new Queue('transcription', {
  connection: redisConnection,
});

export function queueTranscriptionJob(data: { videoUrl: string; title: string; feedId: string; }) {
  return transcriptionQueue.add('transcribe', data, {
    removeOnComplete: true,
    removeOnFail: true,
  });
}
