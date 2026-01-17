import express, { Request, Response } from 'express';
import { prisma } from '../../shared/lib/prisma';
import { transcribeFeedVideo } from '../lib/transcription';
import {
  buildCandidatesFromTranscript,
  decideVideoHasViralMoments,
  scoreAndRankCandidates,
  scoreAndRankCandidatesLLM,
  selectCandidatesDynamically,
  TranscriptWordSegment,
  ScoringMode,
} from '../../../shared/lib/scoring/viral-scoring';
import { detectContentStyle } from '../../../shared/lib/scoring/content-style';

const router = express.Router();

router.post('/', async (req: Request, res: Response): Promise<any> => {
  const {
    feedVideoId,
    userId,
    windowSeconds,
    scoringMode,
    includeAudio,
    saferClips,
    targetPlatform,
    contentStyle,
    // dynamic selection controls
    minCandidates,
    maxCandidates,
    minScore,
    percentile,
    // cost cap for gemini calls
    maxGeminiCandidates,
    strictMinScore,
  } = req.body as {
    feedVideoId?: string;
    userId?: string;
    windowSeconds?: number;
    scoringMode?: ScoringMode;
    includeAudio?: boolean;
    saferClips?: boolean;
    targetPlatform?: 'all' | 'reels' | 'shorts' | 'youtube';
    contentStyle?:
      | 'auto'
      | 'politics'
      | 'comedy'
      | 'education'
      | 'podcast'
      | 'gaming'
      | 'vlog'
      | 'other';
    minCandidates?: number;
    maxCandidates?: number;
    minScore?: number;
    percentile?: number;
    maxGeminiCandidates?: number;
    strictMinScore?: boolean;
    llmProvider?: string;
  };

  if (!feedVideoId || !userId) {
    return res.status(400).json({ error: 'feedVideoId and userId are required' });
  }

  try {
    // Ensure transcript exists (no-op if already present)
    await transcribeFeedVideo(feedVideoId);

    const feedVideo = await prisma.feedVideo.findUnique({ where: { id: feedVideoId } });
    if (!feedVideo?.transcriptJson) {
      return res.status(500).json({ error: 'Transcript is missing after transcription' });
    }

    const transcriptSegments = feedVideo.transcriptJson as TranscriptWordSegment[];

    const fullTranscriptText = transcriptSegments
      .map((s) => s.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const styleDetected = detectContentStyle({
      transcriptText: fullTranscriptText,
      title: feedVideo.title,
    });
    const styleUsed = contentStyle && contentStyle !== 'auto' ? contentStyle : styleDetected.style;
    const platformUsed = targetPlatform ?? 'all';
    const safer = saferClips ?? true;

    const windowPreset =
      platformUsed === 'youtube'
        ? { windowSeconds: 60, maxWindowSeconds: 120 }
        : platformUsed === 'reels' || platformUsed === 'shorts'
          ? { windowSeconds: 26, maxWindowSeconds: 48 }
          : { windowSeconds: 28, maxWindowSeconds: 55 };

    const candidates = buildCandidatesFromTranscript(transcriptSegments, {
      windowSeconds: typeof windowSeconds === 'number' ? windowSeconds : windowPreset.windowSeconds,
      maxWindowSeconds: windowPreset.maxWindowSeconds,
    });
    const mode: ScoringMode = scoringMode || 'heuristic';

    const wantsGemini = mode === 'gemini' || mode === 'hybrid';
    const provider =
      (typeof (req.body as any)?.llmProvider === 'string'
        ? (req.body as any).llmProvider.toLowerCase()
        : '') || (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
    const hasGeminiKey = !!process.env.GOOGLE_API_KEY;
    const needsGeminiKey = provider !== 'ollama';
    const needsVideoAsset = provider !== 'ollama';
    const canLLM = (!needsGeminiKey || hasGeminiKey) && (!needsVideoAsset || !!feedVideo.s3Url);

    if (mode === 'gemini' && !canLLM) {
      return res.status(400).json({
        error: 'LLM scoring requested but missing prerequisites',
        details:
          needsGeminiKey && !hasGeminiKey
            ? 'Missing GOOGLE_API_KEY'
            : 'Missing feedVideo.s3Url for multimodal scoring',
      });
    }

    const safetyMinScoreBump = safer ? 0.25 : 0;
    const selectionOpts = {
      minCandidates,
      maxCandidates,
      minScore: typeof minScore === 'number' ? minScore + safetyMinScoreBump : undefined,
      percentile,
      strictMinScore,
    };

    // Step 1: cheap heuristic score for everyone
    const heuristicAll = scoreAndRankCandidates(candidates, candidates.length || 1);

    // Step 2: optional LLM rerank on a capped subset.
    // IMPORTANT: For hybrid mode, we prefilter by "top-K heuristic" (not by minScore/percentile),
    // otherwise we'd often filter everything out before the LLM ever sees it.
    const geminiCap = Math.max(1, Math.min(maxGeminiCandidates ?? 36, heuristicAll.length || 0));
    const geminiInput = heuristicAll.slice(0, geminiCap).map((c) => ({
      tStartS: c.tStartS,
      tEndS: c.tEndS,
      text: c.text,
    }));

    const scored =
      wantsGemini && canLLM
        ? await scoreAndRankCandidatesLLM({
            s3Url: feedVideo.s3Url || '',
            candidates: geminiInput,
            topN: geminiInput.length || 1,
            prefilterMultiplier: 1,
            includeAudio: includeAudio ?? true,
            targetPlatform: platformUsed,
            contentStyle: styleUsed,
            saferClips: safer,
            providerOverride: provider,
          })
        : heuristicAll;

    // Step 3: dynamic selection on the final score distribution (LLM or heuristic)
    const selectedFinal = selectCandidatesDynamically(scored, selectionOpts);
    const decision = decideVideoHasViralMoments({
      scored: scored as any,
      selection: selectionOpts,
      targetPlatform: platformUsed,
      saferClips: safer,
    });

    // Attach segments to a Video row so we can use the existing Segment/Clip schema.
    // We reuse a "source" Video if one already exists for this user's feed video's s3Url.
    const existingSourceVideo = await prisma.video.findFirst({
      where: {
        userId,
        s3Url: feedVideo.s3Url ?? undefined,
        sourceVideoId: null,
      },
    });

    const prefs = await prisma.templatePreferences.findUnique({ where: { userId } });

    const sourceVideo =
      existingSourceVideo ??
      (await prisma.video.create({
        data: {
          userId,
          videoTitle: feedVideo.title ?? 'Feed video',
          s3Url: feedVideo.s3Url ?? '',
          s3Key: '',
          transcript: feedVideo.transcript ?? '',
          approvedForSplicing: false,
          fileName: '',
          sharedDescription: '',
          facebookTemplate: prefs?.facebookTemplate ?? '',
          instagramTemplate: prefs?.instagramTemplate ?? '',
          youtubeTemplate: prefs?.youtubeTemplate ?? '',
          blueskyTemplate: '',
          twitterTemplate: '',
        },
      }));

    // Replace any previous candidates for this source video to keep the dev loop clean.
    await prisma.segment.deleteMany({ where: { videoId: sourceVideo.id } });

    const created = [];
    for (const seg of selectedFinal) {
      const row = await prisma.segment.create({
        data: {
          videoId: sourceVideo.id,
          tStartS: seg.tStartS,
          tEndS: seg.tEndS,
          score: seg.score,
          selected: true,
          features: {
            ...seg.features,
            text: seg.text,
            feedVideoId,
            scoringMode: mode,
            targetPlatform: platformUsed,
            contentStyle: styleUsed,
            contentStyleDetected: styleDetected,
            saferClips: safer,
          },
        },
      });
      created.push(row);
    }

    return res.json({
      sourceVideoId: sourceVideo.id,
      decision: {
        hasViralMoments: decision.hasViralMoments,
        reason: decision.reason,
        diagnostics: decision.diagnostics,
        recommendation: decision.recommendation,
        targetPlatform: platformUsed,
        contentStyle: styleUsed,
        contentStyleDetected: styleDetected,
        saferClips: safer,
        scoringMode: mode,
      },
      candidates: created.map((s) => ({
        id: s.id,
        tStartS: s.tStartS,
        tEndS: s.tEndS,
        score: s.score,
        selected: s.selected,
        features: s.features,
      })),
    });
  } catch (err: any) {
    console.error('❌ clip-candidates failed:', err);
    return res.status(500).json({ error: 'clip-candidates failed', details: err.message });
  }
});

export default router;
