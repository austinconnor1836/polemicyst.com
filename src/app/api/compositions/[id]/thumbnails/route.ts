import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const composition = await prisma.composition.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!composition) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const thumbnails = await prisma.compositionThumbnail.findMany({
      where: { compositionId: id },
      orderBy: { frameTimestampS: 'asc' },
    });

    return NextResponse.json(thumbnails);
  } catch (err) {
    console.error('[GET /api/compositions/[id]/thumbnails]', err);
    return NextResponse.json({ error: 'Failed to load thumbnails' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const composition = await prisma.composition.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!composition) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await req.json();
    const { thumbnailId } = body;
    if (!thumbnailId) {
      return NextResponse.json({ error: 'thumbnailId required' }, { status: 400 });
    }

    // Deselect all, then select the chosen one — in a transaction
    await prisma.$transaction([
      prisma.compositionThumbnail.updateMany({
        where: { compositionId: id },
        data: { selected: false },
      }),
      prisma.compositionThumbnail.update({
        where: { id: thumbnailId },
        data: { selected: true },
      }),
    ]);

    const thumbnails = await prisma.compositionThumbnail.findMany({
      where: { compositionId: id },
      orderBy: { frameTimestampS: 'asc' },
    });

    return NextResponse.json(thumbnails);
  } catch (err) {
    console.error('[PATCH /api/compositions/[id]/thumbnails]', err);
    return NextResponse.json({ error: 'Failed to select thumbnail' }, { status: 500 });
  }
}
