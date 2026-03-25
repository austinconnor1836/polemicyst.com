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
      select: {
        id: true,
        thumbnailCutoutPosition: true,
        thumbnailCutoutSize: true,
      },
    });
    if (!composition) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const assets = await prisma.thumbnailAsset.findMany({
      where: { compositionId: id },
      orderBy: { frameTimestampS: 'asc' },
    });

    const referenceFrames = assets.filter((a) => a.type === 'reference');
    const cutouts = assets.filter((a) => a.type === 'cutout');

    // Get current selected composite thumbnail URL
    const selectedThumb = await prisma.compositionThumbnail.findFirst({
      where: { compositionId: id, selected: true },
      select: { s3Url: true },
    });

    return NextResponse.json({
      referenceFrames,
      cutouts,
      settings: {
        position: composition.thumbnailCutoutPosition,
        size: composition.thumbnailCutoutSize,
      },
      compositeUrl: selectedThumb?.s3Url ?? null,
    });
  } catch (err) {
    console.error('[GET /api/compositions/[id]/thumbnail-assets]', err);
    return NextResponse.json({ error: 'Failed to load thumbnail assets' }, { status: 500 });
  }
}
