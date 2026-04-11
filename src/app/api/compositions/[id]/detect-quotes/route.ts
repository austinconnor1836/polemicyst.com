import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { unauthorized, badRequest, notFound, serverError, ok } from '@shared/lib/api-response';
import { detectQuotes, type DetectedQuote } from '@shared/lib/quote-detection';

/**
 * POST /api/compositions/:id/detect-quotes
 *
 * Analyze the creator transcript for cited/quoted passages using LLM inference.
 * Saves detected quotes to the composition and returns them.
 *
 * Body (optional):
 *   { style?: string, provider?: string }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorized();

    const { id } = await params;

    const composition = await prisma.composition.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        creatorTranscriptJson: true,
        quoteGraphicStyle: true,
        quoteGraphicsEnabled: true,
        tracks: { select: { transcriptJson: true } },
      },
    });

    if (!composition) return notFound('Composition not found');

    // Combine creator + reference track transcripts for detection
    // Quotes often appear in reference tracks (the video being reacted to)
    const allSegments: Array<{ start: number; end: number; text: string }> = [];
    if (composition.creatorTranscriptJson && Array.isArray(composition.creatorTranscriptJson)) {
      allSegments.push(...(composition.creatorTranscriptJson as any[]));
    }
    for (const track of composition.tracks) {
      if (Array.isArray(track.transcriptJson)) {
        allSegments.push(...(track.transcriptJson as any[]));
      }
    }

    if (allSegments.length === 0) {
      return badRequest(
        'No transcripts available. Upload videos and wait for transcription to complete.'
      );
    }

    // Sort chronologically
    allSegments.sort((a, b) => a.start - b.start);

    let body: { style?: string; provider?: string } = {};
    try {
      body = await req.json();
    } catch {
      // No body is fine
    }

    const result = await detectQuotes(allSegments, body.provider);

    const updateData: Record<string, any> = {
      detectedQuotes: result.quotes as any,
      quoteGraphicsEnabled: true,
    };
    if (body.style) {
      updateData.quoteGraphicStyle = body.style;
    }

    await prisma.composition.update({
      where: { id },
      data: updateData,
    });

    return ok({
      quotes: result.quotes,
      provider: result.provider,
      model: result.model,
      style: body.style || composition.quoteGraphicStyle || 'pull-quote',
    });
  } catch (err) {
    console.error('[detect-quotes] Error:', err);
    return serverError(err instanceof Error ? err.message : 'Quote detection failed');
  }
}

/**
 * GET /api/compositions/:id/detect-quotes
 *
 * Return previously detected quotes for a composition.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorized();

    const { id } = await params;

    const composition = await prisma.composition.findFirst({
      where: { id, userId: user.id },
      select: {
        detectedQuotes: true,
        quoteGraphicStyle: true,
        quoteGraphicsEnabled: true,
      },
    });

    if (!composition) return notFound('Composition not found');

    return ok({
      quotes: (composition.detectedQuotes as DetectedQuote[] | null) || [],
      style: composition.quoteGraphicStyle || 'pull-quote',
      enabled: composition.quoteGraphicsEnabled,
    });
  } catch (err) {
    console.error('[detect-quotes] Error:', err);
    return serverError(err instanceof Error ? err.message : 'Failed to load quotes');
  }
}

/**
 * PUT /api/compositions/:id/detect-quotes
 *
 * Update quote settings (enable/disable, change style, edit quotes manually).
 *
 * Body: { enabled?: boolean, style?: string, quotes?: DetectedQuote[] }
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorized();

    const { id } = await params;

    const composition = await prisma.composition.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });

    if (!composition) return notFound('Composition not found');

    const body = await req.json();
    const updateData: Record<string, any> = {};

    if (typeof body.enabled === 'boolean') {
      updateData.quoteGraphicsEnabled = body.enabled;
    }
    if (body.style) {
      updateData.quoteGraphicStyle = body.style;
    }
    if (Array.isArray(body.quotes)) {
      updateData.detectedQuotes = body.quotes;
    }

    await prisma.composition.update({
      where: { id },
      data: updateData,
    });

    return ok({ updated: true });
  } catch (err) {
    console.error('[detect-quotes] Error:', err);
    return serverError(err instanceof Error ? err.message : 'Failed to update quotes');
  }
}
