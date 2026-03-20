import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { queueGenericTranscriptionJob } from '@shared/queues';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const composition = await prisma.composition.findFirst({
      where: { id, userId: user.id },
      include: {
        tracks: { orderBy: { sortOrder: 'asc' } },
        outputs: true,
      },
    });

    if (!composition) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(composition);
  } catch (err) {
    console.error('[GET /api/compositions/[id]]', err);
    return NextResponse.json({ error: 'Failed to load composition' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const existing = await prisma.composition.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await req.json();
    const allowed = [
      'title',
      'mode',
      'audioMode',
      'creatorVolume',
      'referenceVolume',
      'creatorS3Key',
      'creatorS3Url',
      'creatorDurationS',
      'creatorWidth',
      'creatorHeight',
      'creatorTrimStartS',
      'creatorTrimEndS',
    ] as const;
    const data: Record<string, any> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) {
        data[key] = body[key];
      }
    }

    const composition = await prisma.composition.update({
      where: { id },
      data,
      include: {
        tracks: { orderBy: { sortOrder: 'asc' } },
        outputs: true,
      },
    });

    // Queue transcription when creator video is set (non-fatal)
    if (data.creatorS3Url) {
      try {
        await queueGenericTranscriptionJob({
          s3Url: data.creatorS3Url,
          targetModel: 'Composition',
          targetId: id,
        });
      } catch {
        // Non-fatal
      }
    }

    return NextResponse.json(composition);
  } catch (err) {
    console.error('[PATCH /api/compositions/[id]]', err);
    return NextResponse.json({ error: 'Failed to update composition' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const existing = await prisma.composition.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await prisma.composition.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/compositions/[id]]', err);
    return NextResponse.json({ error: 'Failed to delete composition' }, { status: 500 });
  }
}
