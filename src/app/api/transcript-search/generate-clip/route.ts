import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import {
  badRequest,
  forbidden,
  notFound,
  ok,
  serverError,
  unauthorized,
} from '@shared/lib/api-response';
import { triggerClipGeneration } from '@shared/services/clip-service';
import { logJob } from '@shared/lib/job-logger';

/**
 * POST /api/transcript-search/generate-clip
 * Body: { hitId: string }
 *
 * Enqueue Clipfire's existing clip-generation job biased at the transcript hit's
 * timestamp. Reuses the shared `triggerClipGeneration` service so the same
 * BullMQ queue + idempotency semantics as the normal "Generate clips" button
 * apply here.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorized();

    const body = await req.json().catch(() => null);
    const hitId = body && typeof body.hitId === 'string' ? body.hitId : '';
    if (!hitId) return badRequest('Missing hitId');

    const hit = await prisma.transcriptSearchHit.findUnique({
      where: { id: hitId },
      include: { query: true },
    });
    if (!hit) return notFound('Hit not found');
    if (hit.query.userId !== user.id) {
      return forbidden('Hit does not belong to the authenticated user');
    }

    const result = await triggerClipGeneration({
      feedVideoId: hit.feedVideoId,
      userId: user.id,
      startSec: hit.startSec,
    });

    // Non-fatal job log so the enqueue shows up in the admin logs alongside
    // other clip-generation events, with the transcript hit id for traceability.
    await logJob({
      feedVideoId: hit.feedVideoId,
      jobType: 'clip-generation',
      status: 'queued',
      message: 'Clip-generation enqueued via transcript-search hit',
      metadata: { hitId: hit.id, startSec: hit.startSec, source: 'transcript-search' },
    });

    return ok({
      jobId: result.jobId,
      status: result.status,
      hitId: hit.id,
      feedVideoId: hit.feedVideoId,
      startSec: hit.startSec,
    });
  } catch (err) {
    return serverError('Failed to enqueue clip-generation job', err);
  }
}
