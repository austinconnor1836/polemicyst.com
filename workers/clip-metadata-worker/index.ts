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
import type {
  ReactionComposeJob,
  GenericTranscriptionJob,
  ThumbnailGenerationJob,
} from '@shared/queues';
import { queueGenericTranscriptionJob } from '@shared/queues';
import { renderComposition } from '@shared/util/reactionCompose';
import { transcribeFromS3Url, transcribeLocalFile } from '@shared/lib/transcription';
import { downloadFeedVideoToTemp } from '@shared/util/download';
import {
  detectSilenceFFmpeg,
  analyzeForAutoEdit,
  type TranscriptSegment,
} from '@shared/util/auto-edit-analyzer';
import {
  mergeAutoEditSettings,
  getAggressivenessConfig,
  type AutoEditSettings,
} from '@shared/auto-edit';

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
      showTimestamp,
      captionsEnabled,
      captionFont,
      captionFontSize,
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
              aspectRatio || '9:16',
              {
                showTimestamp: !!showTimestamp,
                captions: captionsEnabled
                  ? {
                      enabled: true,
                      segments: transcriptSegments.filter(
                        (seg: any) => seg.end > c.tStartS && seg.start < c.tEndS
                      ),
                      font: captionFont,
                      fontSize: captionFontSize,
                    }
                  : undefined,
              }
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
                showTimestamp: settings.showTimestamp ?? false,
                captionsEnabled: settings.captionsEnabled ?? false,
                captionFont: settings.captionFont,
                captionFontSize: settings.captionFontSize,
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
          // createdAt is the tiebreaker for tracks that ended up with the same
          // sortOrder due to a concurrent-insert race. Keeps order deterministic.
          tracks: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
          outputs: true,
        },
      });

      // Split tracks by type
      const allTracks = composition?.tracks ?? [];
      const creatorTracks = allTracks.filter(
        (t: any) => (t.trackType ?? 'reference') === 'creator'
      );
      const refTracks = allTracks.filter((t: any) => (t.trackType ?? 'reference') === 'reference');

      const hasCreator = !!composition?.creatorS3Url || creatorTracks.length > 0;
      if (!composition || !hasCreator) {
        console.error(`❌ Composition ${compositionId} not found or missing creator video`);
        await prisma.composition.update({
          where: { id: compositionId },
          data: { status: 'failed' },
        });
        return;
      }

      // 2. Download all inputs
      const { downloadFeedVideoToTemp } = await import('../../shared/util/download');

      let creatorPath: string;

      if (creatorTracks.length > 0) {
        // Multi-creator-track: download each creator track and concatenate with FFmpeg
        console.log(`⬇️ Downloading ${creatorTracks.length} creator track(s)...`);
        const creatorPaths: string[] = [];
        for (const ct of creatorTracks) {
          console.log(`⬇️ Downloading creator track: ${ct.label || ct.id}`);
          const ctPath = await costTracker.track(
            'download',
            () => downloadFeedVideoToTemp(ct.s3Url),
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
          tempFiles.push(ctPath);
          creatorPaths.push(ctPath);
        }

        if (creatorPaths.length === 1) {
          creatorPath = creatorPaths[0];
        } else {
          // Concatenate creator tracks using FFmpeg concat demuxer
          const fsSync = require('fs');
          const pathModule = require('path');
          const osModule = require('os');
          const concatListPath = pathModule.join(
            osModule.tmpdir(),
            `concat_creator_${compositionId}_${Date.now()}.txt`
          );
          const concatOutputPath = pathModule.join(
            osModule.tmpdir(),
            `creator_combined_${compositionId}_${Date.now()}.mp4`
          );
          tempFiles.push(concatListPath, concatOutputPath);

          // Write concat list file — each line: file '/path/to/file'
          const concatContent = creatorPaths
            .map((p: string) => `file '${p.replace(/'/g, "'\\''")}'`)
            .join('\n');
          fsSync.writeFileSync(concatListPath, concatContent);

          console.log(`🔗 Concatenating ${creatorPaths.length} creator tracks...`);
          const { execFileSync } = require('child_process');
          execFileSync(
            'ffmpeg',
            [
              '-y',
              '-f',
              'concat',
              '-safe',
              '0',
              '-i',
              concatListPath,
              '-c',
              'copy',
              '-movflags',
              '+faststart',
              concatOutputPath,
            ],
            { stdio: 'pipe', timeout: 300_000 }
          );
          creatorPath = concatOutputPath;
          console.log('✅ Creator tracks concatenated');
        }
      } else {
        // Legacy single-creator path
        console.log('⬇️ Downloading creator video...');
        creatorPath = await costTracker.track(
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
      }

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
        sourceCrop?: { w: number; h: number; x: number; y: number } | null;
      }> = [];

      for (const track of refTracks) {
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

        // Detect embedded portrait content in landscape references
        const { detectSourceAspectRatio } = await import('../../shared/util/cropDetect');
        const cropResult = await detectSourceAspectRatio(trackPath, track.width, track.height);
        if (cropResult.crop) {
          console.log(
            `🔍 Detected ${cropResult.sourceAspectRatio} source in reference "${track.label || track.id}"`
          );
        }

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
          sourceCrop: cropResult.crop,
        });
      }

      // 3. Look up user's caption settings and wait for transcripts if needed
      const automationRule = await prisma.automationRule.findUnique({
        where: { userId },
        select: { captionsEnabled: true, viralitySettings: true },
      });

      let captionOpts: import('@shared/util/reactionCompose').ComposeCaptionOptions | undefined;
      if (automationRule?.captionsEnabled) {
        // Wait for transcripts to be populated before rendering with captions.
        // Transcription jobs are auto-queued when creator/tracks are added — we just
        // need to poll until they finish (or timeout).
        const POLL_INTERVAL_MS = 3000;
        const POLL_TIMEOUT_MS = 180_000; // 3 minutes
        const pollStart = Date.now();
        let transcriptsReady = false;

        while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
          const fresh = await prisma.composition.findUnique({
            where: { id: compositionId },
            select: {
              creatorTranscriptJson: true,
              tracks: {
                select: { id: true, transcriptJson: true },
                orderBy: { sortOrder: 'asc' },
              },
            },
          });

          const hasCreatorTranscript = !!fresh?.creatorTranscriptJson;
          const hasAllTracks = fresh?.tracks.every((t: any) => !!t.transcriptJson) ?? false;

          if (hasCreatorTranscript && hasAllTracks) {
            transcriptsReady = true;
            // Update composition reference with fresh transcript data
            composition.creatorTranscriptJson = fresh!.creatorTranscriptJson;
            for (const freshTrack of fresh!.tracks) {
              const track = composition.tracks.find((t: any) => t.id === freshTrack.id);
              if (track) track.transcriptJson = freshTrack.transcriptJson;
            }
            break;
          }

          const elapsed = ((Date.now() - pollStart) / 1000).toFixed(0);
          console.log(
            `⏳ Waiting for transcripts (${elapsed}s) — creator=${hasCreatorTranscript}, tracks=${fresh?.tracks.map((t: any) => !!t.transcriptJson).join(',')}`
          );
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }

        if (!transcriptsReady) {
          console.warn('⚠️ Transcript timeout — rendering without captions');
        } else {
          const vs = (automationRule.viralitySettings as Record<string, any>) || {};
          captionOpts = {
            font: vs.captionFont || 'DejaVu Sans',
            fontSize: vs.captionFontSize || 'medium',
            creatorSegments: (composition.creatorTranscriptJson as any[]) || [],
            trackSegments: refTracks.map((t: any) => ({
              segments: (t.transcriptJson as any[]) || [],
              startAtS: t.startAtS,
              trimStartS: t.trimStartS,
              trimEndS: t.trimEndS,
            })),
          };
          console.log(
            `📝 Captions enabled — font=${captionOpts.font}, size=${captionOpts.fontSize}, ` +
              `creatorSegs=${captionOpts.creatorSegments?.length || 0}, ` +
              `trackSegs=${captionOpts.trackSegments?.reduce((n, t) => n + t.segments.length, 0) || 0}`
          );
        }
      }

      // 4. Parse cuts from composition (global — no per-target filtering)
      const compositionCuts: Array<{ startS: number; endS: number }> = Array.isArray(
        composition.cuts
      )
        ? (composition.cuts as any[]).map((c: any) => ({ startS: c.startS, endS: c.endS }))
        : [];

      // 4b. Quote overlay generation (if enabled)
      const quoteOverlaysByLayout: Record<
        string,
        import('@shared/util/reactionCompose').QuoteOverlayInfo[]
      > = {};
      if (composition.quoteGraphicsEnabled && composition.detectedQuotes) {
        try {
          const quotes = composition.detectedQuotes as any[];
          if (quotes.length > 0) {
            const { generateAllQuoteGraphics, cleanupQuoteGraphics } =
              await import('../../shared/util/quoteGraphics');
            const quoteStyle = (composition.quoteGraphicStyle as any) || 'pull-quote';
            const trimOffset = composition.creatorTrimStartS || 0;

            for (const layout of layouts) {
              const isMobile = layout === 'mobile';
              const canvasW = isMobile ? 720 : 1280;
              const canvasH = isMobile ? 1280 : 720;

              const adjustedQuotes = quotes
                .map((q: any) => ({
                  ...q,
                  startS: q.startS - trimOffset,
                  endS: q.endS - trimOffset,
                }))
                .filter((q: any) => q.endS > 0);

              const overlays = await generateAllQuoteGraphics(
                adjustedQuotes,
                quoteStyle,
                canvasW,
                canvasH
              );
              quoteOverlaysByLayout[layout] = overlays.map((ov) => ({
                imagePath: ov.imagePath,
                startS: ov.quote.startS,
                endS: ov.quote.endS,
              }));

              // Track temp files for cleanup
              for (const ov of overlays) {
                tempFiles.push(ov.imagePath);
              }
            }

            console.log(`📖 Generated quote overlays for ${quotes.length} detected quotes`);
          }
        } catch (quoteErr) {
          console.warn(
            '⚠️ Quote overlay generation failed (non-fatal):',
            quoteErr instanceof Error ? quoteErr.message : quoteErr
          );
        }
      }

      // 5. Compute effective creator duration for multi-track
      let effectiveCreatorDurationS = composition.creatorDurationS || 60;
      if (creatorTracks.length > 0) {
        effectiveCreatorDurationS = creatorTracks.reduce((sum: number, ct: any) => {
          const dur = (ct.trimEndS ?? ct.durationS) - ct.trimStartS;
          return sum + Math.max(0, dur);
        }, 0);
        if (effectiveCreatorDurationS <= 0) effectiveCreatorDurationS = 60;
        console.log(
          `📏 Effective creator duration from ${creatorTracks.length} tracks: ${effectiveCreatorDurationS.toFixed(1)}s`
        );
      }

      // 6. Render each layout
      for (const layout of layouts) {
        const output = composition.outputs.find((o: any) => o.layout === layout);
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
                  creatorDurationS: effectiveCreatorDurationS,
                  creatorTrimStartS: creatorTracks.length > 0 ? 0 : composition.creatorTrimStartS,
                  creatorTrimEndS: creatorTracks.length > 0 ? null : composition.creatorTrimEndS,
                  tracks: trackInfos,
                  audioMode: composition.audioMode as 'creator' | 'reference' | 'both',
                  creatorVolume: composition.creatorVolume,
                  referenceVolume: composition.referenceVolume,
                  captions: captionOpts,
                  cuts: compositionCuts.length > 0 ? compositionCuts : undefined,
                  quoteOverlays: quoteOverlaysByLayout[layout],
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

          // Queue transcription for the completed output
          try {
            await queueGenericTranscriptionJob({
              s3Url: result.s3Url,
              targetModel: 'CompositionOutput',
              targetId: output.id,
            });
            console.log(`📝 Queued transcription for ${layout} output`);
          } catch (queueErr) {
            console.warn('⚠️ Failed to queue output transcription (non-fatal):', queueErr);
          }
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
      const allCompleted = updatedOutputs.every((o: any) => o.status === 'completed');
      const anyFailed = updatedOutputs.some((o: any) => o.status === 'failed');

      await prisma.composition.update({
        where: { id: compositionId },
        data: {
          status: allCompleted ? 'completed' : anyFailed ? 'failed' : 'completed',
        },
      });

      console.log(
        `🏁 Reaction compose job complete for ${compositionId} (${Date.now() - startMs}ms)`
      );

      // 5. Auto-generate thumbnail assets (non-fatal)
      if (allCompleted) {
        try {
          const referenceTrack = refTracks[0];
          const creatorS3Url = composition.creatorS3Url || (creatorTracks[0]?.s3Url ?? null);
          if (referenceTrack?.s3Url && creatorS3Url) {
            console.log('🖼️ Auto-generating thumbnail assets...');
            const { generateThumbnailAssets, compositeThumbnailSharp } =
              await import('../../shared/util/thumbnailGenerator');

            const { referenceFrames, cutouts } = await generateThumbnailAssets({
              compositionId,
              referenceS3Url: referenceTrack.s3Url,
              creatorS3Url,
              creatorTrimStartS: creatorTracks.length > 0 ? 0 : composition.creatorTrimStartS,
              creatorDurationS: effectiveCreatorDurationS,
            });

            if (referenceFrames.length > 0 || cutouts.length > 0) {
              // Delete existing assets for re-renders
              await prisma.thumbnailAsset.deleteMany({
                where: { compositionId },
              });

              // Store raw assets
              const allAssets = [...referenceFrames, ...cutouts];
              await prisma.thumbnailAsset.createMany({
                data: allAssets.map((a) => ({
                  compositionId,
                  type: a.type,
                  s3Key: a.s3Key,
                  s3Url: a.s3Url,
                  frameTimestampS: a.frameTimestampS,
                  visionScore: a.visionScore ?? null,
                })),
              });

              console.log(
                `✅ Stored ${referenceFrames.length} reference frames + ${cutouts.length} cutouts`
              );

              // Auto-composite best ref + best cutout as the default thumbnail
              if (referenceFrames.length > 0 && cutouts.length > 0) {
                try {
                  const bestRef = referenceFrames.reduce((a, b) =>
                    (b.visionScore ?? 0) > (a.visionScore ?? 0) ? b : a
                  );
                  const bestCutout = cutouts.reduce((a, b) =>
                    (b.visionScore ?? 0) > (a.visionScore ?? 0) ? b : a
                  );

                  const nodeFetch = require('node-fetch');
                  const [refRes, cutoutRes] = await Promise.all([
                    nodeFetch(bestRef.s3Url),
                    nodeFetch(bestCutout.s3Url),
                  ]);
                  const [refBuf, cutoutBuf] = await Promise.all([
                    refRes.buffer(),
                    cutoutRes.buffer(),
                  ]);

                  const composited = await compositeThumbnailSharp(
                    refBuf,
                    cutoutBuf,
                    'right',
                    'large'
                  );

                  // Upload composited thumbnail
                  const { S3Client } = await import('@aws-sdk/client-s3');
                  const { Upload } = await import('@aws-sdk/lib-storage');
                  const region = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-2';
                  const bucket = process.env.S3_BUCKET || 'clips-genie-uploads';
                  const s3 = new S3Client({ region });
                  const { randomUUID } = await import('crypto');

                  const thumbS3Key = `compositions/${compositionId}/thumbnails/${randomUUID()}.png`;
                  const upload = new Upload({
                    client: s3,
                    params: {
                      Bucket: bucket,
                      Key: thumbS3Key,
                      Body: composited,
                      ContentType: 'image/png',
                    },
                  });
                  await upload.done();

                  const thumbS3Url = `https://${bucket}.s3.${region}.amazonaws.com/${thumbS3Key}`;

                  // Delete old thumbnails and create the auto-composited one as selected
                  await prisma.compositionThumbnail.deleteMany({
                    where: { compositionId },
                  });
                  await prisma.compositionThumbnail.create({
                    data: {
                      compositionId,
                      s3Key: thumbS3Key,
                      s3Url: thumbS3Url,
                      hookText: '',
                      frameTimestampS: bestRef.frameTimestampS,
                      visionScore: bestRef.visionScore ?? null,
                      selected: true,
                    },
                  });

                  console.log('✅ Auto-composited default thumbnail');
                } catch (compErr) {
                  console.warn(
                    '⚠️ Auto-composite failed (non-fatal):',
                    compErr instanceof Error ? compErr.message : compErr
                  );
                }
              }
            } else {
              console.warn('⚠️ Thumbnail asset generation produced no results');
            }
          }
        } catch (thumbErr) {
          console.error(
            '⚠️ Thumbnail generation failed (non-fatal):',
            thumbErr instanceof Error ? thumbErr.message : thumbErr
          );
        }
      }
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

// --- Generic Transcription Worker ---
// Transcribes any S3 video and saves the transcript to the target model.
// Used for composition tracks, creator videos, and render outputs.

new Worker<GenericTranscriptionJob>(
  'generic-transcription',
  async (job) => {
    const { s3Url, targetModel, targetId } = job.data;

    console.log(`📝 [generic-transcription] ${targetModel}:${targetId}`);

    // For Composition: download once, transcribe locally, then run auto-edit on same file
    if (targetModel === 'Composition') {
      let tempPath: string | null = null;
      try {
        tempPath = await downloadFeedVideoToTemp(s3Url);
        const result = await transcribeLocalFile(tempPath);

        await prisma.composition.update({
          where: { id: targetId },
          data: {
            creatorTranscript: result.transcript,
            creatorTranscriptJson: result.segments as any,
          },
        });

        console.log(
          `✅ [generic-transcription] Saved transcript for Composition:${targetId} (${result.transcript.length} chars)`
        );

        // Eager auto-edit: run silencedetect + analysis on the same downloaded file
        try {
          const comp = await prisma.composition.findUnique({
            where: { id: targetId },
            select: { creatorDurationS: true, userId: true, cuts: true },
          });

          if (comp?.creatorDurationS && comp.userId) {
            const rule = await prisma.automationRule.findUnique({
              where: { userId: comp.userId },
              select: { autoEditSettings: true },
            });

            const settings = mergeAutoEditSettings(
              rule?.autoEditSettings as Partial<AutoEditSettings> | null
            );
            const aggrConfig = getAggressivenessConfig(settings.aggressiveness);

            const silenceRegions = await detectSilenceFFmpeg(
              tempPath,
              aggrConfig.silenceThresholdDb,
              aggrConfig.minSilenceDurationS
            );

            console.log(
              `[generic-transcription] silencedetect found ${silenceRegions.length} regions for Composition:${targetId}`
            );

            const segments = result.segments as unknown as TranscriptSegment[];
            const autoEditResult = analyzeForAutoEdit(
              segments,
              settings,
              comp.creatorDurationS,
              silenceRegions
            );

            const updateData: Record<string, any> = {
              silenceRegions: silenceRegions as any,
              autoEditResult: autoEditResult as any,
            };

            // Auto-apply cuts only if no manual cuts exist
            if (!comp.cuts && autoEditResult.cuts.length > 0) {
              updateData.cuts = autoEditResult.cuts.map((c) => ({
                id: c.id,
                startS: c.startS,
                endS: c.endS,
              }));
            }

            await prisma.composition.update({
              where: { id: targetId },
              data: updateData,
            });

            console.log(
              `[generic-transcription] Auto-edit: ${autoEditResult.summary.totalCuts} cuts ` +
                `(${autoEditResult.summary.totalRemovedS}s removed) for Composition:${targetId}`
            );
          }
        } catch (autoEditErr) {
          console.warn(
            `[generic-transcription] Auto-edit failed for Composition:${targetId} (non-fatal):`,
            autoEditErr instanceof Error ? autoEditErr.message : autoEditErr
          );
        }

        // Eager quote detection: analyze creator + reference track transcripts
        try {
          const comp2 = await prisma.composition.findUnique({
            where: { id: targetId },
            select: { quoteGraphicsEnabled: true, userId: true },
          });

          // Check user's automation rule for quote graphics preference
          const rule2 = comp2?.userId
            ? await prisma.automationRule.findUnique({
                where: { userId: comp2.userId },
                select: { quoteGraphicsEnabled: true, quoteGraphicStyle: true },
              })
            : null;

          const shouldDetect = comp2?.quoteGraphicsEnabled || rule2?.quoteGraphicsEnabled;

          if (shouldDetect && result.segments.length > 0) {
            // Combine creator segments with reference track transcripts
            // Quotes often appear in reference tracks (the video being reacted to)
            const allSegments = [...(result.segments as any[])];
            const allRefTracks = await prisma.compositionTrack.findMany({
              where: { compositionId: targetId },
              select: { transcriptJson: true },
            });
            const refTracks = allRefTracks.filter((t) => t.transcriptJson !== null);
            for (const track of refTracks) {
              if (Array.isArray(track.transcriptJson)) {
                allSegments.push(...(track.transcriptJson as any[]));
              }
            }
            // Sort by start time so the LLM sees chronological order
            allSegments.sort((a: any, b: any) => (a.start ?? 0) - (b.start ?? 0));

            const { detectQuotes } = await import('../../shared/lib/quote-detection');
            const quoteResult = await detectQuotes(allSegments);

            if (quoteResult.quotes.length > 0) {
              const quoteUpdateData: Record<string, any> = {
                detectedQuotes: quoteResult.quotes as any,
              };

              // Apply user's default quote style if composition doesn't have one
              if (!comp2?.quoteGraphicsEnabled && rule2?.quoteGraphicStyle) {
                quoteUpdateData.quoteGraphicStyle = rule2.quoteGraphicStyle;
                quoteUpdateData.quoteGraphicsEnabled = true;
              }

              await prisma.composition.update({
                where: { id: targetId },
                data: quoteUpdateData,
              });

              console.log(
                `[generic-transcription] Quote detection: found ${quoteResult.quotes.length} quotes for Composition:${targetId}`
              );
            } else {
              console.log(
                `[generic-transcription] Quote detection: no quotes found for Composition:${targetId} (${allSegments.length} segments analyzed)`
              );
            }
          }
        } catch (quoteErr) {
          console.warn(
            `[generic-transcription] Quote detection failed for Composition:${targetId} (non-fatal):`,
            quoteErr instanceof Error ? quoteErr.message : quoteErr
          );
        }
      } catch (err) {
        console.error(
          `❌ [generic-transcription] Failed for Composition:${targetId}:`,
          err instanceof Error ? err.message : err
        );
      } finally {
        if (tempPath) {
          const fs = await import('fs');
          try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          } catch {}
        }
      }
      return;
    }

    // Non-Composition targets: use original download+transcribe+cleanup flow
    try {
      const result = await transcribeFromS3Url(s3Url);

      switch (targetModel) {
        case 'CompositionTrack':
          await prisma.compositionTrack.update({
            where: { id: targetId },
            data: {
              transcript: result.transcript,
              transcriptJson: result.segments as any,
            },
          });
          break;
        case 'CompositionOutput':
          await prisma.compositionOutput.update({
            where: { id: targetId },
            data: {
              transcript: result.transcript,
              transcriptJson: result.segments as any,
            },
          });
          break;
      }

      console.log(
        `✅ [generic-transcription] Saved transcript for ${targetModel}:${targetId} (${result.transcript.length} chars)`
      );
    } catch (err) {
      console.error(
        `❌ [generic-transcription] Failed for ${targetModel}:${targetId}:`,
        err instanceof Error ? err.message : err
      );
    }
  },
  { connection: redisConnection as any }
);

// --- Thumbnail Generation Worker ---
// Manual regeneration of composition thumbnail assets via queue.

new Worker<ThumbnailGenerationJob>(
  'thumbnail-generation',
  async (job) => {
    const { compositionId, preExtractedReferenceFrames, preExtractedCreatorFrames } = job.data;
    const hasPreExtracted = !!preExtractedReferenceFrames || !!preExtractedCreatorFrames;
    console.log(
      `🖼️ [thumbnail-generation] Processing ${compositionId}${hasPreExtracted ? ' (pre-extracted frames)' : ''}`
    );

    try {
      const composition = await prisma.composition.findUnique({
        where: { id: compositionId },
        include: { outputs: true, tracks: { orderBy: { sortOrder: 'asc' } } },
      });

      if (!composition) {
        console.error(`❌ [thumbnail-generation] Composition ${compositionId} not found`);
        return;
      }

      const referenceTrack = composition.tracks[0];

      // When using pre-extracted frames, S3 URLs for source videos are optional
      if (!hasPreExtracted && (!referenceTrack?.s3Url || !composition.creatorS3Url)) {
        console.warn(`⚠️ [thumbnail-generation] Missing reference track or creator video`);
        return;
      }

      const { generateThumbnailAssets } = await import('../../shared/util/thumbnailGenerator');

      const { referenceFrames, cutouts } = await generateThumbnailAssets({
        compositionId,
        referenceS3Url: referenceTrack?.s3Url || '',
        creatorS3Url: composition.creatorS3Url || '',
        creatorTrimStartS: composition.creatorTrimStartS,
        creatorDurationS: composition.creatorDurationS || undefined,
        preExtractedReferenceFrames,
        preExtractedCreatorFrames,
      });

      if (referenceFrames.length > 0 || cutouts.length > 0) {
        // Delete existing assets
        await prisma.thumbnailAsset.deleteMany({
          where: { compositionId },
        });

        const allAssets = [...referenceFrames, ...cutouts];
        await prisma.thumbnailAsset.createMany({
          data: allAssets.map((a) => ({
            compositionId,
            type: a.type,
            s3Key: a.s3Key,
            s3Url: a.s3Url,
            frameTimestampS: a.frameTimestampS,
            visionScore: a.visionScore ?? null,
          })),
        });

        console.log(
          `✅ [thumbnail-generation] Generated ${referenceFrames.length} refs + ${cutouts.length} cutouts`
        );
      } else {
        console.warn(`⚠️ [thumbnail-generation] No assets generated`);
      }
    } catch (err) {
      console.error(`❌ [thumbnail-generation] Failed:`, err instanceof Error ? err.message : err);
      // Non-fatal — don't rethrow
    }
  },
  { connection: redisConnection as any }
);

// --- HTTP Server for direct transcription requests ---
import { startHttpServer } from './http-server';
startHttpServer();
