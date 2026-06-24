import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { queueStitchRenderJob } from '@shared/queues';
import { validateStitchManifest, type StitchManifest } from '@shared/lib/stitch/manifest';
import { ok, badRequest, notFound, serverError, unauthorized } from '@shared/lib/api-response';

/**
 * POST /api/compositions/[id]/stitch-render
 *
 * Body: a `StitchManifest` object.
 *
 * Persists the manifest onto `Composition.renderConfig`, upserts a
 * `CompositionOutput` row for the manifest's layout in `pending` status, and
 * enqueues a `stitch-render` job. The iOS client can fire this and immediately
 * background the app — the worker renders + uploads in the background.
 *
 * Idempotent on the BullMQ side (jobId = compositionId), so retries are safe.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorized();

    const { id } = await params;

    const composition = await prisma.composition.findFirst({
      where: { id, userId: user.id },
      include: { outputs: true, tracks: true },
    });
    if (!composition) return notFound('Composition not found');

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest('Invalid JSON body');
    }

    const validation = validateStitchManifest(body);
    if (!validation.ok) {
      return badRequest('Invalid manifest', {
        code: 'VALIDATION_ERROR',
        // `errors` isn't part of ApiErrorOptions but the helper spreads
        // unknown keys; downstream this lands in the JSON body.
        ...({ errors: validation.errors } as Record<string, unknown>),
      });
    }

    const manifest = body as StitchManifest;

    // Each clip's trackId must reference a track on this composition.
    const trackIds = new Set(composition.tracks.map((t) => t.id));
    const missingTrackIds = manifest.clips
      .map((c) => c.trackId)
      .filter((tid) => !trackIds.has(tid));
    if (missingTrackIds.length > 0) {
      return badRequest(`Unknown trackId(s): ${missingTrackIds.join(', ')}`, {
        code: 'VALIDATION_ERROR',
      });
    }

    if (composition.status === 'rendering') {
      // 409 — let the iOS client decide whether to wait or retry.
      return badRequest('Render already in progress', { code: 'VALIDATION_ERROR' });
    }

    // Persist the manifest. We treat `renderConfig` as the canonical record of
    // the latest requested render; the worker reads it back before rendering.
    await prisma.composition.update({
      where: { id },
      data: {
        renderConfig: manifest as any,
        status: 'rendering',
      },
    });

    // Upsert the output row for the requested layout.
    const layout = manifest.layout;
    const existing = composition.outputs.find((o) => o.layout === layout);
    let outputId: string;
    if (existing) {
      const updated = await prisma.compositionOutput.update({
        where: { id: existing.id },
        data: {
          status: 'pending',
          renderError: null,
          s3Key: null,
          s3Url: null,
          durationMs: null,
          fileSizeBytes: null,
        },
      });
      outputId = updated.id;
    } else {
      const created = await prisma.compositionOutput.create({
        data: { compositionId: id, layout, status: 'pending' },
      });
      outputId = created.id;
    }

    await queueStitchRenderJob({
      compositionId: id,
      userId: user.id,
      manifest,
    });

    return ok({ status: 'queued', compositionId: id, layout, outputId }, 202);
  } catch (err) {
    return serverError('Failed to enqueue stitch render', err);
  }
}
