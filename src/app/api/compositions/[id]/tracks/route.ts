import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

const MAX_TRACKS = 10;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const composition = await prisma.composition.findFirst({
      where: { id, userId: user.id },
      include: { tracks: true },
    });
    if (!composition) {
      return NextResponse.json({ error: 'Composition not found' }, { status: 404 });
    }

    if (composition.tracks.length >= MAX_TRACKS) {
      return NextResponse.json(
        { error: `Maximum of ${MAX_TRACKS} reference tracks allowed` },
        { status: 400 }
      );
    }

    const body = await req.json();
    const {
      label,
      s3Key,
      s3Url,
      durationS,
      width,
      height,
      startAtS,
      trimStartS,
      trimEndS,
      hasAudio,
    } = body;

    if (!s3Key || !s3Url || durationS == null) {
      return NextResponse.json(
        { error: 'Missing required fields: s3Key, s3Url, durationS' },
        { status: 400 }
      );
    }

    const nextOrder = composition.tracks.length;

    const track = await prisma.compositionTrack.create({
      data: {
        compositionId: id,
        label: label || null,
        s3Key,
        s3Url,
        durationS,
        width: width ?? null,
        height: height ?? null,
        startAtS: startAtS ?? 0,
        trimStartS: trimStartS ?? 0,
        trimEndS: trimEndS ?? null,
        sortOrder: nextOrder,
        hasAudio: hasAudio ?? true,
      },
    });

    return NextResponse.json(track, { status: 201 });
  } catch (err) {
    console.error('[POST /api/compositions/[id]/tracks]', err);
    return NextResponse.json({ error: 'Failed to add track' }, { status: 500 });
  }
}
