import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { getReactionComposeQueue } from '@shared/queues';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const composition = await prisma.composition.findFirst({
      where: { id, userId: user.id },
      include: { tracks: true, outputs: true },
    });
    if (!composition) {
      return NextResponse.json({ error: 'Composition not found' }, { status: 404 });
    }

    const creatorTracks = composition.tracks.filter(
      (t) => (t.trackType ?? 'reference') === 'creator'
    );
    const refTracks = composition.tracks.filter(
      (t) => (t.trackType ?? 'reference') === 'reference'
    );

    const hasCreator = !!composition.creatorS3Key || creatorTracks.length > 0;
    if (!hasCreator) {
      return NextResponse.json({ error: 'Creator video not uploaded' }, { status: 400 });
    }

    if (refTracks.length === 0) {
      return NextResponse.json(
        { error: 'At least one reference track is required' },
        { status: 400 }
      );
    }

    if (composition.status === 'rendering') {
      return NextResponse.json({ error: 'Render already in progress' }, { status: 409 });
    }

    const body = await req.json();
    let layouts: string[] = body.layouts;

    if (!layouts || layouts.length === 0) {
      // Always render both mobile and landscape outputs
      layouts = ['mobile', 'landscape'];
    }

    const validLayouts = layouts.filter((l: string) => l === 'mobile' || l === 'landscape');

    if (validLayouts.length === 0) {
      return NextResponse.json(
        { error: 'At least one valid layout required (mobile, landscape)' },
        { status: 400 }
      );
    }

    // Create/reset output records
    for (const layout of validLayouts) {
      const existing = composition.outputs.find((o) => o.layout === layout);
      if (existing) {
        await prisma.compositionOutput.update({
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
      } else {
        await prisma.compositionOutput.create({
          data: { compositionId: id, layout, status: 'pending' },
        });
      }
    }

    // Mark composition as rendering
    await prisma.composition.update({
      where: { id },
      data: { status: 'rendering' },
    });

    // Enqueue render job
    const queue = getReactionComposeQueue();
    await queue.add(
      'reaction-compose',
      {
        compositionId: id,
        userId: user.id,
        layouts: validLayouts,
      },
      {
        jobId: id,
        removeOnComplete: true,
        removeOnFail: true,
      }
    );

    return NextResponse.json({ status: 'queued', layouts: validLayouts });
  } catch (err) {
    console.error('[POST /api/compositions/[id]/render]', err);
    return NextResponse.json({ error: 'Failed to trigger render' }, { status: 500 });
  }
}
