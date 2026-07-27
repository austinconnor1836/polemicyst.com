import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { queueSplitFrameRenderJob } from '@shared/queues';
import {
  SPLIT_FRAME_OUTPUT_HEIGHT,
  SPLIT_FRAME_OUTPUT_WIDTH,
  validateSplitFrameManifest,
  type SplitFrameManifest,
} from '@shared/lib/split-frame/manifest';
import { badRequest, ok, serverError, unauthorized } from '@shared/lib/api-response';

/**
 * POST /api/split-frame/render
 *
 * Body: { videoUrl, imageUrl, caption? }
 *
 * Creates a new `Composition` row (mode = 'split-frame') scoped to the caller,
 * stores the manifest on `Composition.renderConfig`, upserts a
 * `CompositionOutput` in `pending` state, and enqueues a `split-frame-render`
 * BullMQ job with `jobId = compositionId` (idempotent — POSTing the same
 * manifest again after a failure re-uses the row).
 *
 * The response is `202 { status: 'queued', compositionId, outputId }`. iOS
 * polls `GET /api/split-frame/[id]` until the output flips to `completed`.
 *
 * Reuse of `Composition` + `CompositionOutput` (rather than a dedicated table)
 * mirrors the Stitch pipeline: same admin surface, same job-log rows, same
 * cost-tracking. The `mode` string is how we distinguish these renders in
 * the list endpoint.
 */
const RENDER_MODE = 'split-frame';
const RENDER_LAYOUT = 'split-frame'; // CompositionOutput.layout — distinguishes from stitch's 'mobile'/'landscape'.

const TITLE_ADJECTIVES = [
  'Split',
  'Stacked',
  'Layered',
  'Framed',
  'Composed',
  'Divided',
  'Panelled',
];
const TITLE_NOUNS = ['Frame', 'View', 'Scene', 'Shot', 'Panel', 'Story', 'Card'];
function generateSplitFrameTitle(): string {
  const adj = TITLE_ADJECTIVES[Math.floor(Math.random() * TITLE_ADJECTIVES.length)];
  const noun = TITLE_NOUNS[Math.floor(Math.random() * TITLE_NOUNS.length)];
  return `${adj} ${noun}`;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorized();

    let body: any;
    try {
      body = await req.json();
    } catch {
      return badRequest('Invalid JSON body');
    }

    const { videoUrl, imageUrl, caption, title } = body ?? {};

    // Build the canonical manifest server-side — clients only pass the fields
    // that vary. This keeps `outputWidth` / `outputHeight` / `version` sourced
    // from one place and stops old iOS builds from smuggling in wrong values.
    const manifest: SplitFrameManifest = {
      version: 1,
      videoUrl: typeof videoUrl === 'string' ? videoUrl : '',
      imageUrl: typeof imageUrl === 'string' ? imageUrl : '',
      outputWidth: SPLIT_FRAME_OUTPUT_WIDTH,
      outputHeight: SPLIT_FRAME_OUTPUT_HEIGHT,
      caption: typeof caption === 'string' ? caption : undefined,
    };

    const validation = validateSplitFrameManifest(manifest);
    if (!validation.ok) {
      return badRequest('Invalid manifest', {
        code: 'VALIDATION_ERROR',
        ...({ errors: validation.errors } as Record<string, unknown>),
      });
    }

    const resolvedTitle =
      typeof title === 'string' && title.trim().length > 0
        ? title.trim()
        : generateSplitFrameTitle();

    // Create Composition + pending output in a transaction so a failed enqueue
    // doesn't leave orphan rows behind.
    const { compositionId, outputId } = await prisma.$transaction(async (tx) => {
      const composition = await tx.composition.create({
        data: {
          userId: user.id,
          title: resolvedTitle,
          mode: RENDER_MODE,
          status: 'rendering',
          renderConfig: manifest as any,
        },
      });
      const output = await tx.compositionOutput.create({
        data: {
          compositionId: composition.id,
          layout: RENDER_LAYOUT,
          status: 'pending',
        },
      });
      return { compositionId: composition.id, outputId: output.id };
    });

    await queueSplitFrameRenderJob({
      compositionId,
      userId: user.id,
      manifest,
    });

    return ok(
      {
        status: 'queued',
        compositionId,
        outputId,
        layout: RENDER_LAYOUT,
      },
      202
    );
  } catch (err) {
    return serverError('Failed to enqueue split-frame render', err);
  }
}
