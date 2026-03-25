import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { queueThumbnailGenerationJob } from '@shared/queues';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const composition = await prisma.composition.findFirst({
      where: { id, userId: user.id },
      select: { id: true, status: true },
    });
    if (!composition) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (composition.status !== 'completed') {
      return NextResponse.json(
        { error: 'Composition must be completed before generating thumbnails' },
        { status: 400 }
      );
    }

    await queueThumbnailGenerationJob({
      compositionId: id,
      userId: user.id,
    });

    return NextResponse.json({ success: true, message: 'Thumbnail generation queued' });
  } catch (err) {
    console.error('[POST /api/compositions/[id]/thumbnails/regenerate]', err);
    return NextResponse.json({ error: 'Failed to queue thumbnail generation' }, { status: 500 });
  }
}
