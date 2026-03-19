import { Worker } from 'bullmq';
import { prisma } from '@shared/lib/prisma';
import { getRedisConnection, getClipGenerationQueue, getTranscriptionQueue } from '@shared/queues';
import { transcribeFeedVideo } from './transcription';
import { transcribeFeedVideoWithSpeakers } from './speaker-transcription';
import { checkClipQuota } from '@shared/lib/plans';
import { logJob } from '@shared/lib/job-logger';

const clipGenerationQueue = getClipGenerationQueue();

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

    const startMs = Date.now();
    await logJob({
      feedVideoId: resolvedFeedVideoId,
      jobType: 'transcription',
      status: 'started',
      message: 'Worker picked up transcription job',
    });

    console.log(`Transcribing video for feed video id ${resolvedFeedVideoId}`);
    try {
      console.log('🔍 Checking for existing transcript...');
      await transcribeFeedVideo(resolvedFeedVideoId);
      console.log('🎤 Transcription complete.');

      await logJob({
        feedVideoId: resolvedFeedVideoId,
        jobType: 'transcription',
        status: 'completed',
        message: 'Transcription finished successfully',
        durationMs: Date.now() - startMs,
      });

      // Auto-trigger clip generation if the feed has autoGenerateClips enabled
      const feedVideo = await prisma.feedVideo.findUnique({
        where: { id: resolvedFeedVideoId },
        include: { feed: true },
      });
      if (feedVideo?.feed?.autoGenerateClips && feedVideo.feed.viralitySettings) {
        const feedUser = await prisma.user.findUnique({
          where: { id: feedVideo.feed.userId },
          select: { subscriptionPlan: true },
        });
        const clipQuota = await checkClipQuota(feedVideo.feed.userId, feedUser?.subscriptionPlan);
        if (!clipQuota.allowed) {
          console.warn(
            `⚠️ Clip quota exceeded for user ${feedVideo.feed.userId}. Skipping auto clip generation.`
          );
        } else {
          const settings = feedVideo.feed.viralitySettings as Record<string, any>;
          const strictnessPreset = settings.strictnessPreset || 'balanced';
          const strictnessConfig = {
            minScore: 6.5,
            percentile: 0.85,
            minCandidates: 3,
            maxCandidates: 20,
            maxGeminiCandidates: 24,
            ...(strictnessPreset === 'strict'
              ? {
                  minScore: 7.0,
                  percentile: 0.9,
                  minCandidates: 3,
                  maxCandidates: 12,
                  maxGeminiCandidates: 18,
                }
              : strictnessPreset === 'loose'
                ? {
                    minScore: 6.0,
                    percentile: 0.75,
                    minCandidates: 5,
                    maxCandidates: 24,
                    maxGeminiCandidates: 36,
                  }
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
              showTimestamp: settings.showTimestamp ?? false,
              ...strictnessConfig,
            },
            { jobId: resolvedFeedVideoId, removeOnComplete: true, removeOnFail: true }
          );
          console.log(`transcription: auto enqueued clip-generation for ${resolvedFeedVideoId}`);
        }
      }
    } catch (transcriptionError: any) {
      const errorMessage =
        transcriptionError instanceof Error
          ? transcriptionError.message
          : String(transcriptionError);

      await logJob({
        feedVideoId: resolvedFeedVideoId,
        jobType: 'transcription',
        status: 'failed',
        message: 'Transcription failed',
        error: errorMessage,
        durationMs: Date.now() - startMs,
      });

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
  { connection: getRedisConnection() as any }
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

    const startMs = Date.now();
    await logJob({
      feedVideoId,
      jobType: 'speaker-transcription',
      status: 'started',
      message: 'Worker picked up speaker-transcription job',
    });

    console.log(`Speaker-transcribing video for feed video id ${feedVideoId}`);
    try {
      await transcribeFeedVideoWithSpeakers(feedVideoId, {
        numSpeakers: numSpeakers ?? undefined,
      });
      console.log('Speaker transcription complete.');

      await logJob({
        feedVideoId,
        jobType: 'speaker-transcription',
        status: 'completed',
        message: 'Speaker transcription finished successfully',
        durationMs: Date.now() - startMs,
      });
    } catch (err: any) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await logJob({
        feedVideoId,
        jobType: 'speaker-transcription',
        status: 'failed',
        message: 'Speaker transcription failed',
        error: errorMessage,
        durationMs: Date.now() - startMs,
      });

      console.error('Speaker transcription failed:', err);
      throw err;
    }
  },
  { connection: getTranscriptionQueue().opts.connection as any }
);
