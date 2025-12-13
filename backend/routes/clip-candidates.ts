import express, { Request, Response } from 'express';
import { prisma } from '../../shared/lib/prisma';
import { transcribeFeedVideo } from '../lib/transcription';
import { buildCandidatesFromTranscript, scoreAndRankCandidates, TranscriptWordSegment } from '../lib/viral-scoring';

const router = express.Router();

router.post('/', async (req: Request, res: Response): Promise<any> => {
  const {
    feedVideoId,
    userId,
    topN,
    windowSeconds,
  } = req.body as {
    feedVideoId?: string;
    userId?: string;
    topN?: number;
    windowSeconds?: number;
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
    const candidates = buildCandidatesFromTranscript(transcriptSegments, {
      windowSeconds: typeof windowSeconds === 'number' ? windowSeconds : 28,
    });
    const ranked = scoreAndRankCandidates(candidates, typeof topN === 'number' ? topN : 12);

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
    for (const [idx, seg] of ranked.entries()) {
      const row = await prisma.segment.create({
        data: {
          videoId: sourceVideo.id,
          tStartS: seg.tStartS,
          tEndS: seg.tEndS,
          score: seg.score,
          selected: idx < 5, // mark top 5 as selected by default
          features: {
            ...seg.features,
            text: seg.text,
            feedVideoId,
          },
        },
      });
      created.push(row);
    }

    return res.json({
      sourceVideoId: sourceVideo.id,
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


