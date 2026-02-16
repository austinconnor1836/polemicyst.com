import { Worker, Queue } from 'bullmq';
import { prisma } from '@shared/lib/prisma';
import { transcriptionQueue, getSpeakerTranscriptionQueue } from '@shared/queues';
import { transcribeFeedVideo } from './transcription';
import { transcribeFeedVideoWithSpeakers } from './speaker-transcription';

const clipGenerationQueue = new Queue('clip-generation', {
  connection: transcriptionQueue.opts.connection as any,
});

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

      // Auto-trigger clip generation if the feed has autoGenerateClips enabled
      const feedVideo = await prisma.feedVideo.findUnique({
        where: { id: resolvedFeedVideoId },
        include: { feed: true },
      });
      if (feedVideo?.feed?.autoGenerateClips && feedVideo.feed.viralitySettings) {
        const settings = feedVideo.feed.viralitySettings as Record<string, any>;
        const strictnessPreset = settings.strictnessPreset || 'balanced';
        const strictnessConfig = {
          minScore: 6.5,
          percentile: 0.85,
          minCandidates: 3,
          maxCandidates: 20,
          maxGeminiCandidates: 24,
          ...(strictnessPreset === 'strict'
            ? { minScore: 7.0, percentile: 0.9, minCandidates: 3, maxCandidates: 12, maxGeminiCandidates: 18 }
            : strictnessPreset === 'loose'
              ? { minScore: 6.0, percentile: 0.75, minCandidates: 5, maxCandidates: 24, maxGeminiCandidates: 36 }
              : {}),
        };

        await clipGenerationQueue.add(
          'clip-generation',
          {
            feedVideoId: resolvedFeedVideoId,
            userId: feedVideo.feed.userId,
            aspectRatio: '9:16',
            scoringMode: settings.scoringMode || 'hybrid',
            includeAudio: settings.includeAudio || false,
            saferClips: settings.saferClips ?? true,
            targetPlatform: settings.targetPlatform || 'reels',
            contentStyle: settings.contentStyle || 'auto',
            llmProvider: settings.llmProvider,
            ...strictnessConfig,
          },
          { jobId: resolvedFeedVideoId, removeOnComplete: true, removeOnFail: true }
        );
        console.log(`transcription: auto enqueued clip-generation for ${resolvedFeedVideoId}`);
      }
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

// Speaker-identified transcription worker
new Worker(
  'speaker-transcription',
  async (job) => {
    const { feedVideoId, numSpeakers } = job.data ?? {};
    if (!feedVideoId) {
      console.warn(`Skipping speaker-transcription job ${job.id}: missing feedVideoId`);
      return;
    }
    console.log(`Speaker-transcribing video for feed video id ${feedVideoId}`);
    try {
      await transcribeFeedVideoWithSpeakers(feedVideoId, {
        numSpeakers: numSpeakers ?? undefined,
      });
      console.log('Speaker transcription complete.');
    } catch (err: any) {
      console.error('Speaker transcription failed:', err);
      throw err;
    }
  },
  { connection: transcriptionQueue.opts.connection as any }
);
