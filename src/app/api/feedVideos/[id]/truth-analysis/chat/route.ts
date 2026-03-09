import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { CostTracker } from '@shared/lib/cost-tracking';
import { TruthTrainingCollector } from '@shared/lib/truth-training-collector';
import { chatAboutAnalysis, type ChatMessage } from '@shared/lib/scoring/truth-chat';
import type { TruthAnalysisResult } from '@shared/lib/scoring/truth-analysis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/feedVideos/:id/truth-analysis/chat?clipId=xxx
 * Returns existing chat history + analysis result.
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

  // Load the truth analysis result
  const analysis = await prisma.truthAnalysis.findUnique({
    where: { feedVideoId_clipId: { feedVideoId: id, clipId } },
    select: { result: true },
  });

  // Load existing chat with messages
  const chat = await prisma.analysisChat.findUnique({
    where: { feedVideoId_clipId: { feedVideoId: id, clipId } },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, content: true, createdAt: true },
      },
    },
  });

  return NextResponse.json({
    chat: chat ?? null,
    analysis: analysis?.result ?? null,
  });
}

/**
 * POST /api/feedVideos/:id/truth-analysis/chat
 * Body: { message: string, clipId?: string, provider?: 'gemini' | 'ollama' }
 * Sends a user message, gets AI response, saves both to DB.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  let body: { message?: string; clipId?: string; provider?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  }

  const clipId = body.clipId || '__video__';
  const provider = body.provider === 'ollama' ? 'ollama' : 'gemini';

  // Load feed video with transcript
  const feedVideo = await prisma.feedVideo.findUnique({
    where: { id },
    select: { id: true, userId: true, transcript: true, transcriptJson: true },
  });

  if (!feedVideo || feedVideo.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Extract transcript text
  const transcriptJson = feedVideo.transcriptJson as Array<{
    start: number;
    end: number;
    text: string;
  }> | null;
  let transcript = '';
  if (transcriptJson && Array.isArray(transcriptJson) && transcriptJson.length > 0) {
    transcript = transcriptJson
      .map((s) => s.text)
      .join(' ')
      .trim();
  } else if (feedVideo.transcript?.trim()) {
    transcript = feedVideo.transcript.trim();
  }

  if (!transcript) {
    return NextResponse.json({ error: 'No transcript available' }, { status: 400 });
  }

  // Load the truth analysis
  const analysis = await prisma.truthAnalysis.findUnique({
    where: { feedVideoId_clipId: { feedVideoId: id, clipId } },
    select: { result: true },
  });

  if (!analysis?.result) {
    return NextResponse.json(
      { error: 'No analysis found. Run "Verify with AI" first.' },
      { status: 400 }
    );
  }

  const analysisResult = analysis.result as unknown as TruthAnalysisResult;

  // Load or create the chat
  let chat = await prisma.analysisChat.findUnique({
    where: { feedVideoId_clipId: { feedVideoId: id, clipId } },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        select: { role: true, content: true },
      },
    },
  });

  if (!chat) {
    chat = await prisma.analysisChat.create({
      data: {
        feedVideoId: id,
        clipId,
        userId: user.id,
        provider,
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { role: true, content: true },
        },
      },
    });
  }

  // Build conversation history including the new user message
  const history: ChatMessage[] = [
    ...chat.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: message },
  ];

  const costTracker = new CostTracker(user.id, id);
  const trainingCollector = new TruthTrainingCollector(user.id, id);

  try {
    const result = await costTracker.track(
      'llm_scoring',
      () =>
        chatAboutAnalysis({
          transcript,
          analysisResult,
          messages: history,
          provider,
        }),
      (r, durationMs) => ({
        provider,
        model: r._cost?.modelName,
        inputTokens: r._cost?.inputTokens,
        outputTokens: r._cost?.outputTokens,
        estimatedCostUsd: r._cost?.estimatedCostUsd,
        durationMs,
        metadata: { type: 'truth_chat' },
      })
    );

    // Save user message + assistant response
    await prisma.analysisChatMessage.createMany({
      data: [
        {
          chatId: chat.id,
          role: 'user',
          content: message,
        },
        {
          chatId: chat.id,
          role: 'assistant',
          content: result.content,
          inputTokens: result._cost?.inputTokens ?? null,
          outputTokens: result._cost?.outputTokens ?? null,
          estimatedCostUsd: result._cost?.estimatedCostUsd ?? null,
          durationMs: result._cost?.durationMs ?? null,
        },
      ],
    });

    // Collect training example for chat distillation
    trainingCollector.add({
      provider,
      model: result._cost?.modelName,
      type: 'chat',
      transcriptText: transcript,
      analysisContext: analysisResult as unknown as Record<string, any>,
      conversationHistory: history,
      result: { content: result.content },
      inputTokens: result._cost?.inputTokens,
      outputTokens: result._cost?.outputTokens,
      estimatedCostUsd: result._cost?.estimatedCostUsd,
      durationMs: result._cost?.durationMs,
    });

    // Flush costs + training data non-fatally
    await Promise.all([
      costTracker.flush().catch((err) => {
        console.error('[truth-chat] Cost flush failed (non-fatal):', err);
      }),
      trainingCollector.flush().catch((err) => {
        console.error('[truth-chat] Training flush failed (non-fatal):', err);
      }),
    ]);

    return NextResponse.json({
      ok: true,
      message: { role: 'assistant', content: result.content },
    });
  } catch (err: any) {
    console.error('[truth-chat] Chat failed:', err);
    return NextResponse.json({ error: err.message || 'Chat failed' }, { status: 500 });
  }
}
