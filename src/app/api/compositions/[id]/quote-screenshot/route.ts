import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { unauthorized, badRequest, notFound, serverError, ok } from '@shared/lib/api-response';

/**
 * POST /api/compositions/:id/quote-screenshot
 *
 * Take a screenshot of a quote from its source URL. Returns the screenshot
 * as a base64-encoded PNG data URL that can be previewed in the UI.
 *
 * Body: { sourceUrl: string, quoteText: string, attribution?: string }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const { sourceUrl, quoteText, attribution } = body;

    if (!sourceUrl || typeof sourceUrl !== 'string') {
      return badRequest('sourceUrl is required');
    }
    if (!quoteText || typeof quoteText !== 'string') {
      return badRequest('quoteText is required');
    }

    try {
      new URL(sourceUrl);
    } catch {
      return badRequest('sourceUrl must be a valid URL');
    }

    const { screenshotQuoteFromUrl } = await import('@shared/util/quoteScreenshot');

    const result = await screenshotQuoteFromUrl({
      sourceUrl,
      quoteText,
      width: 720,
      height: 1280,
      attribution: attribution || null,
    });

    const fs = await import('fs');
    const pngBuffer = fs.readFileSync(result.imagePath);
    const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;

    try {
      fs.unlinkSync(result.imagePath);
    } catch {}

    return ok({
      preview: dataUrl,
      textFound: result.textFound,
      width: result.width,
      height: result.height,
    });
  } catch (err) {
    console.error('[quote-screenshot] Error:', err);
    return serverError(err instanceof Error ? err.message : 'Screenshot failed');
  }
}
