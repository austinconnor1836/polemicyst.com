import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

/**
 * POST /api/compositions/[id]/render/client-complete
 *
 * Save a client-rendered output to the composition.
 * Called after the browser renders locally and uploads the output to S3.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const { layout, s3Key, s3Url, durationMs } = body;

    if (!layout || !s3Key || !s3Url) {
      return NextResponse.json({ error: 'layout, s3Key, and s3Url are required' }, { status: 400 });
    }

    if (layout !== 'mobile' && layout !== 'landscape') {
      return NextResponse.json(
        { error: 'layout must be "mobile" or "landscape"' },
        { status: 400 }
      );
    }

    // Verify composition belongs to user
    const composition = await prisma.composition.findFirst({
      where: { id, userId: user.id },
      include: { outputs: true },
    });
    if (!composition) {
      return NextResponse.json({ error: 'Composition not found' }, { status: 404 });
    }

    // Upsert the output record
    const existing = composition.outputs.find((o) => o.layout === layout);
    if (existing) {
      await prisma.compositionOutput.update({
        where: { id: existing.id },
        data: {
          s3Key,
          s3Url,
          status: 'completed',
          renderError: null,
          durationMs: durationMs ?? null,
        },
      });
    } else {
      await prisma.compositionOutput.create({
        data: {
          compositionId: id,
          layout,
          s3Key,
          s3Url,
          status: 'completed',
          durationMs: durationMs ?? null,
        },
      });
    }

    // Update composition status if all outputs are complete
    const allOutputs = await prisma.compositionOutput.findMany({
      where: { compositionId: id },
    });
    const allComplete = allOutputs.every((o) => o.status === 'completed');
    if (allComplete) {
      await prisma.composition.update({
        where: { id },
        data: { status: 'completed' },
      });
    }

    return NextResponse.json({ status: 'saved' });
  } catch (err) {
    console.error('[POST /api/compositions/[id]/render/client-complete]', err);
    return NextResponse.json({ error: 'Failed to save render' }, { status: 500 });
  }
}
