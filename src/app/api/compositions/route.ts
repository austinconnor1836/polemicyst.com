import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const compositions = await prisma.composition.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        tracks: { orderBy: { sortOrder: 'asc' } },
        outputs: true,
      },
    });

    return NextResponse.json(compositions);
  } catch (err) {
    console.error('[GET /api/compositions]', err);
    return NextResponse.json({ error: 'Failed to load compositions' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      title,
      mode,
      audioMode,
      creatorVolume,
      referenceVolume,
      creatorS3Key,
      creatorS3Url,
      creatorDurationS,
    } = body;

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const composition = await prisma.composition.create({
      data: {
        userId: user.id,
        title,
        mode: mode || 'pre-synced',
        audioMode: audioMode || 'creator',
        creatorVolume: creatorVolume ?? 1.0,
        referenceVolume: referenceVolume ?? 1.0,
        creatorS3Key: creatorS3Key || null,
        creatorS3Url: creatorS3Url || null,
        creatorDurationS: creatorDurationS || null,
      },
      include: {
        tracks: true,
        outputs: true,
      },
    });

    return NextResponse.json(composition, { status: 201 });
  } catch (err) {
    console.error('[POST /api/compositions]', err);
    return NextResponse.json({ error: 'Failed to create composition' }, { status: 500 });
  }
}
