import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { Prisma } from '@prisma/client';

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

    await prisma.compositionTrack.delete({ where: { id: trackId } });

    // Clean orphaned cut targets
    if (composition.cuts && Array.isArray(composition.cuts)) {
      const cleaned = (composition.cuts as any[])
        .map((cut: any) => ({
          ...cut,
          targets: cut.targets.filter((t: string) => t !== trackId),
        }))
        .filter((cut: any) => cut.targets.length > 0);

      const cutsChanged =
        cleaned.length !== (composition.cuts as any[]).length ||
        cleaned.some(
          (c: any, i: number) =>
            c.targets.length !== (composition.cuts as any[])[i]?.targets?.length
        );

      if (cutsChanged) {
        await prisma.composition.update({
          where: { id },
          data: { cuts: cleaned.length > 0 ? cleaned : Prisma.DbNull },
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/compositions/[id]/tracks/[trackId]]', err);
    return NextResponse.json({ error: 'Failed to delete track' }, { status: 500 });
  }
}
