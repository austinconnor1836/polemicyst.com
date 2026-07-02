import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { downloadFeedVideoToTemp } from '@shared/util/download';
import { detectReactionBoundaries } from '@shared/util/reaction-boundaries';
import { parseRect } from '@shared/lib/reaction-capture';

/**
 * POST /api/reaction-sessions/detect-boundaries
 *
 * Body: { captureS3Url, referenceRect?, threshold?, minSegmentS?, maxSegmentS?, useBlackDetect? }
 *
 * Downloads the uploaded capture, runs scene-cut detection over the reference region,
 * and returns the reaction windows for the review timeline. Nothing is persisted here —
 * the client confirms/adjusts the windows before POSTing to `/api/reaction-sessions`.
 */
export async function POST(req: NextRequest) {
  let tempPath: string | null = null;
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const captureS3Url = body.captureS3Url;
    if (typeof captureS3Url !== 'string' || !captureS3Url) {
      return NextResponse.json({ error: 'captureS3Url is required' }, { status: 400 });
    }

    // referenceRect is optional — omit to scan the full frame.
    const referenceRect = body.referenceRect === undefined ? null : parseRect(body.referenceRect);
    if (body.referenceRect !== undefined && !referenceRect) {
      return NextResponse.json({ error: 'referenceRect must be { x, y, w, h }' }, { status: 400 });
    }

    const threshold = typeof body.threshold === 'number' ? body.threshold : undefined;
    const minSegmentS = typeof body.minSegmentS === 'number' ? body.minSegmentS : undefined;
    const maxSegmentS = typeof body.maxSegmentS === 'number' ? body.maxSegmentS : undefined;
    const useBlackDetect = body.useBlackDetect === true;

    if (threshold !== undefined && (threshold <= 0 || threshold >= 1)) {
      return NextResponse.json({ error: 'threshold must be in (0, 1)' }, { status: 400 });
    }

    tempPath = await downloadFeedVideoToTemp(captureS3Url);

    const result = await detectReactionBoundaries(tempPath, {
      refRect: referenceRect,
      threshold,
      minSegmentS,
      maxSegmentS,
      useBlackDetect,
    });

    return NextResponse.json({
      durationS: result.durationS,
      rawCutCount: result.rawCutCount,
      threshold: result.threshold,
      minSegmentS: result.minSegmentS,
      maxSegmentS: result.maxSegmentS,
      boundaries: result.windows.map((w) => ({
        startS: w.startS,
        endS: w.endS,
        durationS: w.durationS,
        overLimit: w.overLimit,
      })),
    });
  } catch (err) {
    console.error('[POST /api/reaction-sessions/detect-boundaries]', err);
    const message = err instanceof Error ? err.message : 'Failed to detect boundaries';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (tempPath) {
      await fs.unlink(tempPath).catch(() => {});
    }
  }
}
