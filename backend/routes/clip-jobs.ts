import express, { Request, Response } from 'express';
import { clipGenerationQueue } from '../queues';

const router = express.Router();

/**
 * Enqueue a clip-generation job (currently generates clip candidates).
 * This is the clean entrypoint for local end-to-end testing: API -> queue -> worker -> API -> DB.
 */
router.post('/enqueue', async (req: Request, res: Response): Promise<any> => {
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
  } = req.body as {
    feedVideoId?: string;
    userId?: string;
    aspectRatio?: string;
    scoringMode?: 'heuristic' | 'gemini' | 'hybrid';
    includeAudio?: boolean;
    saferClips?: boolean;
    targetPlatform?: 'all' | 'reels' | 'shorts' | 'youtube';
    contentStyle?: 'auto' | 'politics' | 'comedy' | 'education' | 'podcast' | 'gaming' | 'vlog' | 'other';
    minCandidates?: number;
    maxCandidates?: number;
    minScore?: number;
    percentile?: number;
    maxGeminiCandidates?: number;
  };

  if (!feedVideoId || !userId) {
    return res.status(400).json({ error: 'feedVideoId and userId are required' });
  }

  try {
    const job = await clipGenerationQueue.add(
      'generate',
      {
        feedVideoId,
        userId,
        aspectRatio: aspectRatio || '9:16',
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
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    return res.json({ ok: true, jobId: job.id });
  } catch (err: any) {
    console.error('❌ Failed to enqueue clip-generation job:', err);
    return res.status(500).json({ error: 'Failed to enqueue job', details: err.message });
  }
});

export default router;


