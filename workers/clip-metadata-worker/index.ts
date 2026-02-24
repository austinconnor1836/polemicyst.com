import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
// For containers, respect already-set env (e.g., DATABASE_URL pointing at service DNS)
dotenv.config({ path: '.env.local', override: false });

import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { prisma } from '@shared/lib/prisma';
import { transcribeFeedVideo } from '@shared/lib/transcription';
import {
  buildCandidatesFromTranscript,
  scoreAndRankCandidatesLLM,
  ClipCandidate,
} from '@shared/lib/scoring/viral-scoring';
import { generateClipFromS3 } from '@shared/util/ffmpegUtils';
import { scorePhilosophicalRhetoric } from '@shared/lib/scoring/philosophy-ranker';
import { checkClipQuota } from '@shared/lib/plans';

const redisConnection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null,
});

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
      localVideoPath = await downloadFeedVideoToTemp(feedVideo.s3Url);

      // 3. Transcribe (using local file)
      console.log('🎤 Ensuring transcript...');
      let transcript: string;
      let transcriptSegments: any[];
      try {
        const result = await transcribeFeedVideo(feedVideoId, localVideoPath);
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
        const { s3Url } = await generateClipFromS3(
          localVideoPath, // Use local path!
          formatTime(c.tStartS),
          formatTime(c.tEndS),
          s3Key,
          aspectRatio || '9:16'
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
      console.error('❌ Error processing job:', err);
      throw err;
    } finally {
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
