import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { CostTracker } from '@shared/lib/cost-tracking';
import { TruthTrainingCollector } from '@shared/lib/truth-training-collector';
import {
  analyzeTranscriptWithGemini,
  analyzeTranscriptWithOllama,
  type TruthAnalysisResult,
} from '@shared/lib/scoring/truth-analysis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TranscriptSegment = { start: number; end: number; text: string };

function extractTranscriptText(
  transcriptJson: TranscriptSegment[] | null | undefined,
  fullTranscript: string | null | undefined,
  clipStartS?: number,
  clipEndS?: number
): string | null {
  if (transcriptJson && Array.isArray(transcriptJson) && transcriptJson.length > 0) {
    let segments = transcriptJson;
    if (clipStartS != null && clipEndS != null) {
      segments = segments.filter((seg) => seg.end > clipStartS && seg.start < clipEndS);
    }
    const text = segments
      .map((s) => s.text)
      .join(' ')
      .trim();
    return text || null;
  }
  if (fullTranscript?.trim()) {
    return fullTranscript.trim();
  }
  return null;
}

/**
 * GET /api/feedVideos/:id/truth-analysis?clipId=xxx
 * Returns existing analysis or 404.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const clipId = req.nextUrl.searchParams.get('clipId') || '__video__';

  const feedVideo = await prisma.feedVideo.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!feedVideo || feedVideo.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const analysis = await prisma.truthAnalysis.findUnique({
    where: { feedVideoId_clipId: { feedVideoId: id, clipId } },
  });

  if (!analysis) {
    return NextResponse.json({ error: 'No analysis available' }, { status: 404 });
  }

  return NextResponse.json(analysis);
}

/**
 * POST /api/feedVideos/:id/truth-analysis
 * Body: { clipId?: string, provider?: 'gemini' | 'ollama' }
 * Runs analysis inline and persists result.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  let body: { clipId?: string; provider?: string } = {};
  try {
    body = await req.json();
  } catch {
    // No body is fine — defaults apply
  }

  const clipId = body.clipId || '__video__';
  const provider = body.provider === 'ollama' ? 'ollama' : 'gemini';

  const feedVideo = await prisma.feedVideo.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      transcript: true,
      transcriptJson: true,
    },
  });

  if (!feedVideo || feedVideo.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // For clip analysis, look up the clip's trim bounds
  let clipStartS: number | undefined;
  let clipEndS: number | undefined;
  if (clipId !== '__video__') {
    const clip = await prisma.video.findUnique({
      where: { id: clipId },
      select: { trimStartS: true, trimEndS: true, feedVideoId: true },
    });
    if (!clip || clip.feedVideoId !== id) {
      return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
    }
    clipStartS = clip.trimStartS ?? undefined;
    clipEndS = clip.trimEndS ?? undefined;
  }

  const transcript = extractTranscriptText(
    feedVideo.transcriptJson as TranscriptSegment[] | null,
    feedVideo.transcript,
    clipStartS,
    clipEndS
  );

  if (!transcript) {
    return NextResponse.json(
      { error: 'No transcript available for this video. Transcribe it first.' },
      { status: 400 }
    );
  }

  // Upsert a pending record
  await prisma.truthAnalysis.upsert({
    where: { feedVideoId_clipId: { feedVideoId: id, clipId } },
    create: {
      feedVideoId: id,
      clipId,
      userId: user.id,
      provider,
      status: 'processing',
    },
    update: {
      provider,
      status: 'processing',
      error: null,
    },
  });

  const costTracker = new CostTracker(user.id, id);
  const trainingCollector = new TruthTrainingCollector(user.id, id);

  try {
    let result: TruthAnalysisResult;

    if (provider === 'gemini') {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        throw new Error('GOOGLE_API_KEY is not configured');
      }
      result = await costTracker.track(
        'llm_scoring',
        () => analyzeTranscriptWithGemini({ apiKey, transcript }),
        (r, durationMs) => ({
          provider: 'gemini',
          model: r._cost?.modelName,
          inputTokens: r._cost?.inputTokens,
          outputTokens: r._cost?.outputTokens,
          estimatedCostUsd: r._cost?.estimatedCostUsd,
          durationMs,
          metadata: { type: 'truth_analysis' },
        })
      );
    } else {
      result = await costTracker.track(
        'llm_scoring',
        () => analyzeTranscriptWithOllama({ transcript }),
        (r, durationMs) => ({
          provider: 'ollama',
          model: r._cost?.modelName,
          inputTokens: r._cost?.inputTokens,
          outputTokens: r._cost?.outputTokens,
          estimatedCostUsd: 0,
          durationMs,
          metadata: { type: 'truth_analysis' },
        })
      );
    }

    // Strip _cost before saving to DB
    const { _cost, ...resultForDb } = result;

    await prisma.truthAnalysis.update({
      where: { feedVideoId_clipId: { feedVideoId: id, clipId } },
      data: {
        status: 'completed',
        result: resultForDb as any,
        model: _cost?.modelName ?? null,
        inputTokens: _cost?.inputTokens ?? null,
        outputTokens: _cost?.outputTokens ?? null,
        estimatedCostUsd: _cost?.estimatedCostUsd ?? null,
        durationMs: _cost?.durationMs ?? null,
      },
    });

    // Collect training example
    trainingCollector.add({
      provider,
      model: _cost?.modelName,
      type: 'analysis',
      transcriptText: transcript,
      result: resultForDb as Record<string, any>,
      overallCredibility: resultForDb.overallCredibility,
      assertionCount: resultForDb.assertions?.length,
      fallacyCount: resultForDb.fallacies?.length,
      biasCount: resultForDb.biases?.length,
      inputTokens: _cost?.inputTokens,
      outputTokens: _cost?.outputTokens,
      estimatedCostUsd: _cost?.estimatedCostUsd,
      durationMs: _cost?.durationMs,
    });

    // Flush costs + training data non-fatally
    await Promise.all([
      costTracker.flush().catch((err) => {
        console.error('[truth-analysis] Cost flush failed (non-fatal):', err);
      }),
      trainingCollector.flush().catch((err) => {
        console.error('[truth-analysis] Training flush failed (non-fatal):', err);
      }),
    ]);

    return NextResponse.json({
      ok: true,
      status: 'completed',
      result: resultForDb,
    });
  } catch (err: any) {
    console.error('[truth-analysis] Analysis failed:', err);

    await prisma.truthAnalysis.update({
      where: { feedVideoId_clipId: { feedVideoId: id, clipId } },
      data: {
        status: 'failed',
        error: err.message || 'Unknown error',
      },
    });

    return NextResponse.json({ error: err.message || 'Analysis failed' }, { status: 500 });
  }
}
