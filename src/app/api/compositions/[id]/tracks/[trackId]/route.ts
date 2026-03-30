import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { deleteFromS3 } from '@shared/lib/s3';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; trackId: string }> }
) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, trackId } = await params;

    // Verify ownership
    const composition = await prisma.composition.findFirst({
      where: { id, userId: user.id },
    });
    if (!composition) {
      return NextResponse.json({ error: 'Composition not found' }, { status: 404 });
    }

    const existing = await prisma.compositionTrack.findFirst({
      where: { id: trackId, compositionId: id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Track not found' }, { status: 404 });
    }

    const body = await req.json();
    const allowed = [
      'label',
      'startAtS',
      'trimStartS',
      'trimEndS',
      'sortOrder',
      'hasAudio',
    ] as const;
    const data: Record<string, any> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) {
        data[key] = body[key];
      }
    }

    const track = await prisma.compositionTrack.update({
      where: { id: trackId },
      data,
    });

    return NextResponse.json(track);
  } catch (err) {
    console.error('[PATCH /api/compositions/[id]/tracks/[trackId]]', err);
    return NextResponse.json({ error: 'Failed to update track' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; trackId: string }> }
) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, trackId } = await params;

    const composition = await prisma.composition.findFirst({
      where: { id, userId: user.id },
    });
    if (!composition) {
      return NextResponse.json({ error: 'Composition not found' }, { status: 404 });
    }

    const existing = await prisma.compositionTrack.findFirst({
      where: { id: trackId, compositionId: id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Track not found' }, { status: 404 });
    }

    // Best-effort S3 cleanup
    if (existing.s3Key) {
      try {
        await deleteFromS3(existing.s3Key);
      } catch (err) {
        console.error(`[DELETE track] Failed to delete S3 object ${existing.s3Key}:`, err);
      }
    }

    await prisma.compositionTrack.delete({ where: { id: trackId } });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/compositions/[id]/tracks/[trackId]]', err);
    return NextResponse.json({ error: 'Failed to delete track' }, { status: 500 });
  }
}
