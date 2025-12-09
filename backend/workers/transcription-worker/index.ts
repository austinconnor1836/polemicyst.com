require('module-alias/register');
import { Worker } from 'bullmq';
import { transcriptionQueue } from '@shared/queues';
import { transcribeFeedVideo } from './transcription';

new Worker(
  'transcription',
  async (job) => {
    const { title, sourceUrl, feedVideoId } = job.data;
    // Download the file from S3
    // Call your transcription logic (e.g., call the API or run the model)
    // Save the transcript to the DB
    // For now, just log the job
    console.log(`Transcribing video for feed video id ${feedVideoId}`);
    try {
          console.log('🔍 Checking for existing transcript...');
          await transcribeFeedVideo(feedVideoId);
          console.log('🎤 Transcription complete.');
        } catch (transcriptionError: any) {
          console.error('❌ Transcription failed:', transcriptionError);
        }
  },
  { connection: transcriptionQueue.opts.connection }
);
