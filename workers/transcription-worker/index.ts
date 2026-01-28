import { Worker } from 'bullmq';
import { prisma } from '@shared/lib/prisma';
import { transcriptionQueue } from '@shared/queues';
import { transcribeFeedVideo } from './transcription';

new Worker(
  'transcription',
  async (job) => {
    const { title, sourceUrl, feedVideoId, feedId, videoId } = job.data ?? {};
    let resolvedFeedVideoId =
      typeof feedVideoId === 'string' && feedVideoId.trim() ? feedVideoId : null;

    if (!resolvedFeedVideoId && typeof sourceUrl === 'string' && sourceUrl.trim()) {
      const feedVideo = await prisma.feedVideo.findFirst({
        where: { s3Url: sourceUrl },
        select: { id: true },
      });
      resolvedFeedVideoId = feedVideo?.id ?? null;
    }

    if (!resolvedFeedVideoId && typeof feedId === 'string' && typeof videoId === 'string') {
      const feedVideo = await prisma.feedVideo.findUnique({
        where: { feedId_videoId: { feedId, videoId } },
        select: { id: true },
      });
      resolvedFeedVideoId = feedVideo?.id ?? null;
    }

    if (!resolvedFeedVideoId) {
      console.warn(
        `⚠️ Skipping transcription job ${job.id}: missing feedVideoId (data keys: ${Object.keys(
          job.data ?? {}
        ).join(', ')})`
      );
      return;
    }
    // Download the file from S3
    // Call your transcription logic (e.g., call the API or run the model)
    // Save the transcript to the DB
    // For now, just log the job
    console.log(`Transcribing video for feed video id ${resolvedFeedVideoId}`);
    try {
      console.log('🔍 Checking for existing transcript...');
      await transcribeFeedVideo(resolvedFeedVideoId);
      console.log('🎤 Transcription complete.');
    } catch (transcriptionError: any) {
      if (
        resolvedFeedVideoId &&
        transcriptionError instanceof Error &&
        /No audio stream found/i.test(transcriptionError.message)
      ) {
        try {
          await prisma.feedVideo.update({
            where: { id: resolvedFeedVideoId },
            data: { status: 'failed' },
          });
        } catch (updateErr) {
          console.error('Failed to mark feed video as failed:', updateErr);
        }
      }
      console.error('❌ Transcription failed:', transcriptionError);
    }
  },
  { connection: transcriptionQueue.opts.connection as any }
);
