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
        thumbnailBgMode: true,
        thumbnailBgCrop: true,
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
    const aiBackgrounds = assets.filter((a) => a.type === 'ai_background');
    const customBackgrounds = assets
      .filter((a) => a.type === 'custom_background')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Get current selected composite thumbnail URL
    const selectedThumb = await prisma.compositionThumbnail.findFirst({
      where: { compositionId: id, selected: true },
      select: { s3Url: true },
    });

    return NextResponse.json({
      referenceFrames,
      cutouts,
      aiBackgrounds,
      customBackgrounds,
      settings: {
        position: composition.thumbnailCutoutPosition,
        size: composition.thumbnailCutoutSize,
        bgMode: composition.thumbnailBgMode,
        bgCrop: composition.thumbnailBgCrop ? JSON.parse(composition.thumbnailBgCrop) : null,
      },
      compositeUrl: selectedThumb?.s3Url ?? null,
    });
  } catch (err) {
    console.error('[GET /api/compositions/[id]/thumbnail-assets]', err);
    return NextResponse.json({ error: 'Failed to load thumbnail assets' }, { status: 500 });
  }
}
