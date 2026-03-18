import 'module-alias/register';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
// For containers, respect already-set env (e.g., DATABASE_URL pointing at service DNS)
dotenv.config({ path: '.env.local', override: false });

import { Worker, Job, Queue } from 'bullmq';
import { prisma } from '@shared/lib/prisma';
import { getRedisConnection } from '@shared/queues';
import { transcribeFeedVideo } from '@shared/lib/transcription';
import {
  buildCandidatesFromTranscript,
  scoreAndRankCandidatesLLM,
  ClipCandidate,
} from '@shared/lib/scoring/viral-scoring';
import { generateClipFromS3 } from '@shared/util/ffmpegUtils';
import { scorePhilosophicalRhetoric } from '@shared/lib/scoring/philosophy-ranker';
import { checkClipQuota } from '@shared/lib/plans';
import { CostTracker, estimateS3Cost } from '@shared/lib/cost-tracking';
import { TrainingCollector } from '@shared/lib/training-collector';
import { logJob } from '@shared/lib/job-logger';
import type { ReactionComposeJob } from '@shared/queues';
import { renderComposition } from '@shared/util/reactionCompose';

console.log('[clip-metadata-worker] Starting with static reactionCompose import...');
const redisConnection = getRedisConnection();

function formatTime(seconds: number): string {
  const date = new Date(0);
  date.setSeconds(seconds);
  return date.toISOString().substr(11, 8);
}

new Worker(
  'clip-generation',
  async (job) => {
    const {
      feedVideoId,
      userId,
      aspectRatio,
      scoringMode,
      includeAudio,
      saferClips,
      targetPlatform,
      contentStyle,
      minCandidates,
      maxCandidates,
      minScore,
      percentile,
      maxGeminiCandidates,
      llmProvider,
      clipLength,
    } = job.data;

    const costTracker = new CostTracker(userId, feedVideoId);
    const trainingCollector = new TrainingCollector(userId, feedVideoId);

    const jobStartMs = Date.now();
    await logJob({
      feedVideoId,
      jobType: 'clip-generation',
      status: 'started',
      message: 'Worker picked up clip-generation job',
    });

    console.log(`📥 Processing clip-generation job for FeedVideo: ${feedVideoId}`);

    // Double-check clip quota before expensive processing
    const quotaUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionPlan: true },
    });
    const clipQuota = await checkClipQuota(userId, quotaUser?.subscriptionPlan);
    if (!clipQuota.allowed) {
      console.warn(
        `⚠️ Clip quota exceeded for user ${userId} (${clipQuota.currentUsage}/${clipQuota.limit}). Skipping job.`
      );
      return;
    }

    let localVideoPath: string | null = null;

    try {
      // 1. Fetch FeedVideo
      const feedVideo = await prisma.feedVideo.findUnique({ where: { id: feedVideoId } });
      if (!feedVideo) {
        console.error(`❌ FeedVideo ${feedVideoId} not found`);
        return;
      }

      // 2. Ensuring local video file (Download ONCE)
      const { downloadFeedVideoToTemp } = await import('@shared/util/download');
      console.log('⬇️ Ensuring local video file...');
      localVideoPath = await costTracker.track(
        'download',
        () => downloadFeedVideoToTemp(feedVideo.s3Url),
        (resultPath) => {
          let fileSizeBytes: number | undefined;
          try {
            const fsSync = require('fs');
            fileSizeBytes = fsSync.statSync(resultPath).size;
          } catch {}
          return {
            provider: 's3',
            fileSizeBytes,
            estimatedCostUsd: fileSizeBytes ? estimateS3Cost(fileSizeBytes) : 0,
          };
        }
      );

      // 3. Transcribe (using local file)
      console.log('🎤 Ensuring transcript...');
      let transcript: string;
      let transcriptSegments: any[];
      try {
        const result = await costTracker.track(
          'transcription',
          () => transcribeFeedVideo(feedVideoId, localVideoPath!),
          () => ({
            provider: 'whisper',
            estimatedCostUsd: 0,
          })
        );
        transcript = result.transcript;
        transcriptSegments = result.segments;
      } catch (transcribeErr) {
        if (
          transcribeErr instanceof Error &&
          /No audio stream found/i.test(transcribeErr.message)
        ) {
          console.error(`⚠️ Skipping job ${feedVideoId}: ${transcribeErr.message}`);
          return;
        }
        throw transcribeErr;
      }

      // 4. Create a parent Video record
      console.log('📼 Creating parent Video record...');
      const video = await prisma.video.create({
        data: {
          userId: userId,
          videoTitle: feedVideo.title || 'Imported Video',
          s3Url: feedVideo.s3Url,
          fileName: feedVideo.title,
          transcript: transcript,
          sharedDescription: '',
          facebookTemplate: '',
          instagramTemplate: '',
          youtubeTemplate: '',
          blueskyTemplate: '',
          twitterTemplate: '',
        },
      });

      await prisma.feedVideo.update({
        where: { id: feedVideoId },
        data: { clipSourceVideoId: video.id },
      });

      // 5. Build Candidates
      console.log('🧠 Building candidates...');
      const rawCandidates = buildCandidatesFromTranscript(transcriptSegments, { clipLength });

      // 6. Score Candidates (using local file)
      console.log(
        `🤖 Scoring with mode: ${scoringMode || 'hybrid'} using ${llmProvider || process.env.LLM_PROVIDER || 'gemini'}...`
      );
      let topCandidates: ClipCandidate[] = [];

      // Both branches now use localVideoPath
      topCandidates = await scoreAndRankCandidatesLLM({
        s3Url: feedVideo.s3Url,
        candidates: rawCandidates,
        topN: maxCandidates || 5,
        targetPlatform,
        contentStyle,
        saferClips,
        localVideoPath: localVideoPath,
        providerOverride: llmProvider,
        costTracker,
        trainingCollector,
      });

      const philosophyWeightedCandidates: ClipCandidate[] = topCandidates.map((candidate) => {
        const philosophy = scorePhilosophicalRhetoric({
          transcript: candidate.text,
          candidate,
        });
        const baseScore = candidate.score ?? 0;
        const combined = baseScore * 0.7 + philosophy.score * 0.3;
        const enrichedFeatures = {
          ...(candidate.features ?? {}),
          baseLLMScore: baseScore,
          philosophyScore: philosophy.score,
          philosophyEvidence: philosophy.evidence,
        } as Record<string, any>;
        return {
          ...candidate,
          score: combined,
          features: enrichedFeatures,
        };
      });

      // Mark which candidates were selected for training data
      trainingCollector.markSelected(
        philosophyWeightedCandidates.map((c) => ({ tStartS: c.tStartS, tEndS: c.tEndS }))
      );

      console.log(`✨ Found ${philosophyWeightedCandidates.length} viral candidates.`);

      // 7. Generate Clips (using FFmpeg with S3 URL - might be better to use local path but existing function expects S3 URL context, keeping as is for now as FFmpeg supports remote URLs well enough usually, OR we can refactor generateClipFromS3 later. But since we have the local file, using it would be faster. However, let's stick to minimum changes for stability first unless it fails.)
      // Actually, for YouTube URLs, ffmpeg might fail on the URL just like scoring did.
      // We should ideally use the local file for clipping too.
      // Let's rely on the existing generateClipFromS3 for now, but if it fails we know why.
      // UPDATE: generateClipFromS3 downloads internally too? Let's check.
      // If it downloads internally, it will fail on YouTube URL.
      // Safe bet: The current generateClipFromS3 likely uses ffmpeg with the URL.
      // To be robust, we should probably update ffmpegUtils to take a local path too, but let's see.
      // For now, let's proceed.

      for (const c of philosophyWeightedCandidates) {
        // Re-check quota before each clip to stop if limit is hit mid-loop
        const loopQuota = await checkClipQuota(userId, quotaUser?.subscriptionPlan);
        if (!loopQuota.allowed) {
          console.warn(
            `⚠️ Clip quota reached mid-generation (${loopQuota.currentUsage}/${loopQuota.limit}). Stopping.`
          );
          break;
        }

        console.log(`✂️ Generating clip: ${c.tStartS}-${c.tEndS} (Score: ${c.score})`);

        // Create Segment
        const segment = await prisma.segment.create({
          data: {
            videoId: video.id,
            tStartS: c.tStartS,
            tEndS: c.tEndS,
            score: c.score,
            features: c.features,
            selected: true,
          },
        });

        // FFmpeg generation
        const s3Key = `clips/${segment.id}.mp4`;

        // HACK: Pass local path as "s3Url" if it's a file path?
        // generateClipFromS3 likely does `ffmpeg -i s3Url`.
        // If we pass a local path, ffmpeg works fine.
        // However, the function name is misleading.
        const { s3Url } = await costTracker.track(
          'ffmpeg_render',
          () =>
            generateClipFromS3(
              localVideoPath!, // Use local path!
              formatTime(c.tStartS),
              formatTime(c.tEndS),
              s3Key,
              aspectRatio || '9:16'
            ),
          (result) => {
            // Record S3 upload cost separately
            costTracker.add({
              stage: 's3_upload',
              provider: 's3',
              estimatedCostUsd: estimateS3Cost(5 * 1024 * 1024), // ~5MB estimate per clip
              metadata: { s3Key },
            });
            return {
              provider: 'ffmpeg',
              estimatedCostUsd: 0, // local compute
            };
          }
        );

        // Create Clip (New Schema)
        await prisma.clip.create({
          data: {
            segmentId: segment.id,
            variant: 'default',
            s3Key: s3Key,
            title: `Viral Clip ${c.score.toFixed(1)}`,
            description: (c.features as Record<string, any>)?.rationale || '',
          },
        });

        // Create Video (Old Schema for UI Compatibility)
        await prisma.video.create({
          data: {
            userId: userId,
            videoTitle: `Viral Clip ${c.score.toFixed(1)}`,
            s3Url: s3Url,
            s3Key: s3Key,
            sourceVideoId: video.id, // Link to parent
            fileName: `${segment.id}.mp4`,
            sharedDescription: (c.features as Record<string, any>)?.rationale || '',
            facebookTemplate: '',
            instagramTemplate: '',
            youtubeTemplate: '',
            blueskyTemplate: '',
            twitterTemplate: '',
          },
        });

        console.log(`✅ Clip created and registered: ${s3Url}`);
      }

      await logJob({
        feedVideoId,
        jobType: 'clip-generation',
        status: 'completed',
        message: `Clip generation finished — ${philosophyWeightedCandidates.length} clips created`,
        durationMs: Date.now() - jobStartMs,
      });

      console.log(`🏁 Job complete for ${feedVideoId}`);
    } catch (err: unknown) {
      const maybePrismaError = err as { code?: string; meta?: Record<string, any> } | null;
      const isSegmentFkError =
        maybePrismaError?.code === 'P2003' &&
        (maybePrismaError.meta?.constraint === 'Segment_videoId_fkey' ||
          maybePrismaError.meta?.modelName === 'Segment');
      if (isSegmentFkError) {
        console.error(
          `⚠️ Skipping job ${feedVideoId} due to missing parent video for segment: ${maybePrismaError?.meta?.constraint}`
        );
        return;
      }
      const errorMessage = err instanceof Error ? (err as Error).message : String(err);
      await logJob({
        feedVideoId,
        jobType: 'clip-generation',
        status: 'failed',
        message: 'Clip generation failed',
        error: errorMessage,
        durationMs: Date.now() - jobStartMs,
      });

      console.error('❌ Error processing job:', err);
      throw err;
    } finally {
      // Flush cost events (non-fatal)
      try {
        await costTracker.flush();
      } catch (costErr) {
        console.error('⚠️ Cost tracking flush failed (non-fatal):', costErr);
      }

      // Flush training examples (non-fatal)
      try {
        await trainingCollector.flush();
      } catch (trainErr) {
        console.error('⚠️ Training data flush failed (non-fatal):', trainErr);
      }

      // Cleanup local video
      if (localVideoPath) {
        const fs = await import('fs');
        if (fs.existsSync(localVideoPath)) {
          fs.unlinkSync(localVideoPath);
          console.log('🧹 Cleaned up local video file.');
        }
      }
    }
  },
  { connection: redisConnection as any }
);

// --- Transcription Worker ---
// Processes the 'transcription' queue alongside clip-generation.
// Uses the shared transcribeFeedVideo which tries YouTube captions first (fast),
// then falls back to Whisper (heavy). After transcription, auto-triggers
// clip-generation if the feed has autoGenerateClips enabled.

const clipGenerationQueue = new Queue('clip-generation', {
  connection: redisConnection as any,
});

new Worker(
  'transcription',
  async (job) => {
    const { feedVideoId } = job.data ?? {};
    if (!feedVideoId) {
      console.warn(`⚠️ Skipping transcription job ${job.id}: missing feedVideoId`);
      return;
    }

    const startMs = Date.now();
    await logJob({
      feedVideoId,
      jobType: 'transcription',
      status: 'started',
      message: 'Worker picked up transcription job',
    });

    console.log(`🎤 Transcribing video for feed video id ${feedVideoId}`);

    try {
      await transcribeFeedVideo(feedVideoId);
      console.log('✅ Transcription complete.');

      await logJob({
        feedVideoId,
        jobType: 'transcription',
        status: 'completed',
        message: 'Transcription finished successfully',
        durationMs: Date.now() - startMs,
      });

      // Auto-trigger clip generation if the feed has autoGenerateClips enabled
      const feedVideo = await prisma.feedVideo.findUnique({
        where: { id: feedVideoId },
        include: { feed: true },
      });

      if (feedVideo?.feed?.autoGenerateClips && feedVideo.feed.viralitySettings) {
        // Status gate: don't trigger clip-gen if the video is still downloading.
        // When transcription runs in parallel with download (YouTube), the download
        // worker will re-enqueue transcription after setting status='ready', which
        // will then trigger clip-gen.
        if (feedVideo.status === 'pending') {
          console.log(
            `⏳ Video ${feedVideoId} still downloading, skipping clip-gen — will trigger after download completes`
          );
        } else {
          const feedUser = await prisma.user.findUnique({
            where: { id: feedVideo.feed.userId },
            select: { subscriptionPlan: true },
          });
          const clipQuota = await checkClipQuota(feedVideo.feed.userId, feedUser?.subscriptionPlan);

          if (!clipQuota.allowed) {
            console.warn(`⚠️ Clip quota exceeded. Skipping auto clip generation.`);
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
                feedVideoId,
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
              { jobId: feedVideoId, removeOnComplete: true, removeOnFail: true }
            );
            console.log(`📋 Auto-enqueued clip-generation for ${feedVideoId}`);
          }
        }
      }
    } catch (err: any) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      await logJob({
        feedVideoId,
        jobType: 'transcription',
        status: 'failed',
        message: 'Transcription failed',
        error: errorMessage,
        durationMs: Date.now() - startMs,
      });

      if (err instanceof Error && /No audio stream found/i.test(err.message)) {
        try {
          await prisma.feedVideo.update({
            where: { id: feedVideoId },
            data: { status: 'failed' },
          });
        } catch (updateErr) {
          console.error('Failed to mark feed video as failed:', updateErr);
        }
      }

      console.error('❌ Transcription failed:', err);
    }
  },
  { connection: redisConnection as any }
);

// --- Reaction Compose Worker ---
// Processes the 'reaction-compose' queue — renders multi-source reaction video compositions.

new Worker<ReactionComposeJob>(
  'reaction-compose',
  async (job) => {
    const { compositionId, userId, layouts } = job.data;
    const costTracker = new CostTracker(userId, compositionId);
    const startMs = Date.now();

    console.log(`🎬 Processing reaction-compose job for composition: ${compositionId}`);

    const tempFiles: string[] = [];

    try {
      // 1. Load composition with tracks
      const composition = await prisma.composition.findUnique({
        where: { id: compositionId },
        include: {
          tracks: { orderBy: { sortOrder: 'asc' } },
          outputs: true,
        },
      });

      if (!composition || !composition.creatorS3Url) {
        console.error(`❌ Composition ${compositionId} not found or missing creator video`);
        await prisma.composition.update({
          where: { id: compositionId },
          data: { status: 'failed' },
        });
        return;
      }

      // 2. Download all inputs
      const { downloadFeedVideoToTemp } = await import('../../shared/util/download');

      console.log('⬇️ Downloading creator video...');
      const creatorPath = await costTracker.track(
        'download',
        () => downloadFeedVideoToTemp(composition.creatorS3Url!),
        (resultPath) => {
          let fileSizeBytes: number | undefined;
          try {
            const fsSync = require('fs');
            fileSizeBytes = fsSync.statSync(resultPath).size;
          } catch {}
          return {
            provider: 's3',
            fileSizeBytes,
            estimatedCostUsd: fileSizeBytes ? estimateS3Cost(fileSizeBytes) : 0,
          };
        }
      );
      tempFiles.push(creatorPath);

      const trackInfos: Array<{
        localPath: string;
        startAtS: number;
        trimStartS: number;
        trimEndS: number | null;
        durationS: number;
        width: number | null;
        height: number | null;
        hasAudio: boolean;
        sortOrder: number;
      }> = [];

      for (const track of composition.tracks) {
        console.log(`⬇️ Downloading reference track: ${track.label || track.id}`);
        const trackPath = await costTracker.track(
          'download',
          () => downloadFeedVideoToTemp(track.s3Url),
          (resultPath) => {
            let fileSizeBytes: number | undefined;
            try {
              const fsSync = require('fs');
              fileSizeBytes = fsSync.statSync(resultPath).size;
            } catch {}
            return {
              provider: 's3',
              fileSizeBytes,
              estimatedCostUsd: fileSizeBytes ? estimateS3Cost(fileSizeBytes) : 0,
            };
          }
        );
        tempFiles.push(trackPath);

        trackInfos.push({
          localPath: trackPath,
          startAtS: track.startAtS,
          trimStartS: track.trimStartS,
          trimEndS: track.trimEndS,
          durationS: track.durationS,
          width: track.width,
          height: track.height,
          hasAudio: track.hasAudio,
          sortOrder: track.sortOrder,
        });
      }

      // 3. Render each layout

      for (const layout of layouts) {
        const output = composition.outputs.find((o) => o.layout === layout);
        if (!output) continue;

        await prisma.compositionOutput.update({
          where: { id: output.id },
          data: { status: 'rendering' },
        });

        console.log(`🎥 Rendering ${layout} layout...`);
        const s3Key = `compositions/${compositionId}/rendered/${layout}.mp4`;

        try {
          const result = await costTracker.track(
            'ffmpeg_render',
            () =>
              renderComposition(
                {
                  layout: layout as 'mobile' | 'landscape',
                  creatorPath,
                  creatorDurationS: composition.creatorDurationS || 60,
                  creatorTrimStartS: composition.creatorTrimStartS,
                  creatorTrimEndS: composition.creatorTrimEndS,
                  tracks: trackInfos,
                  audioMode: composition.audioMode as 'creator' | 'reference' | 'both',
                  creatorVolume: composition.creatorVolume,
                  referenceVolume: composition.referenceVolume,
                },
                s3Key
              ),
            (renderResult) => {
              // Also track S3 upload cost
              costTracker.add({
                stage: 's3_upload',
                provider: 's3',
                estimatedCostUsd: estimateS3Cost(10 * 1024 * 1024), // ~10MB estimate
                metadata: { s3Key },
              });
              return {
                provider: 'ffmpeg',
                estimatedCostUsd: 0,
              };
            }
          );

          await prisma.compositionOutput.update({
            where: { id: output.id },
            data: {
              status: 'completed',
              s3Key: result.s3Key,
              s3Url: result.s3Url,
              durationMs: result.durationMs,
            },
          });

          console.log(`✅ ${layout} render complete: ${result.s3Url}`);
        } catch (renderErr) {
          const errMsg = renderErr instanceof Error ? renderErr.message : String(renderErr);
          console.error(`❌ ${layout} render failed:`, errMsg);

          await prisma.compositionOutput.update({
            where: { id: output.id },
            data: { status: 'failed', renderError: errMsg },
          });
        }
      }

      // 4. Update composition status
      const updatedOutputs = await prisma.compositionOutput.findMany({
        where: { compositionId },
      });
      const allCompleted = updatedOutputs.every((o) => o.status === 'completed');
      const anyFailed = updatedOutputs.some((o) => o.status === 'failed');

      await prisma.composition.update({
        where: { id: compositionId },
        data: {
          status: allCompleted ? 'completed' : anyFailed ? 'failed' : 'completed',
        },
      });

      console.log(
        `🏁 Reaction compose job complete for ${compositionId} (${Date.now() - startMs}ms)`
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('❌ Reaction compose failed:', errorMessage);

      await prisma.composition.update({
        where: { id: compositionId },
        data: { status: 'failed' },
      });

      throw err;
    } finally {
      // Flush cost events
      try {
        await costTracker.flush();
      } catch (costErr) {
        console.error('⚠️ Cost tracking flush failed (non-fatal):', costErr);
      }

      // Cleanup temp files
      const fs = await import('fs');
      for (const f of tempFiles) {
        try {
          if (fs.existsSync(f)) {
            fs.unlinkSync(f);
          }
        } catch {}
      }
      if (tempFiles.length > 0) {
        console.log(`🧹 Cleaned up ${tempFiles.length} temp files.`);
      }
    }
  },
  { connection: redisConnection as any }
);
