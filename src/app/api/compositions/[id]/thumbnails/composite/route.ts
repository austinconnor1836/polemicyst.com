import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { compositeThumbnailSharp } from '@shared/util/thumbnailGenerator';
import sharp from 'sharp';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { randomUUID } from 'crypto';

const VALID_POSITIONS = ['left', 'right'] as const;
const VALID_SIZES = ['small', 'medium', 'large'] as const;

type Position = (typeof VALID_POSITIONS)[number];
type Size = (typeof VALID_SIZES)[number];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const { referenceAssetId, cutoutAssetId, position, size, bgMode, bgCrop } = body;

    if (!referenceAssetId || !cutoutAssetId) {
      return NextResponse.json(
        { error: 'referenceAssetId and cutoutAssetId are required' },
        { status: 400 }
      );
    }

    const pos: Position = VALID_POSITIONS.includes(position) ? position : 'right';
    const sz: Size = VALID_SIZES.includes(size) ? size : 'large';

    // Fetch both assets (background can be a frame, generated image, or user upload)
    const [refAsset, cutoutAsset] = await Promise.all([
      prisma.thumbnailAsset.findFirst({
        where: {
          id: referenceAssetId,
          compositionId: id,
          type: { in: ['reference', 'ai_background', 'custom_background'] },
        },
      }),
      prisma.thumbnailAsset.findFirst({
        where: { id: cutoutAssetId, compositionId: id, type: 'cutout' },
      }),
    ]);

    if (!refAsset || !cutoutAsset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    // Download both images from S3 in parallel
    const [refRes, cutoutRes] = await Promise.all([
      fetch(refAsset.s3Url),
      fetch(cutoutAsset.s3Url),
    ]);

    if (!refRes.ok || !cutoutRes.ok) {
      return NextResponse.json({ error: 'Failed to download assets from S3' }, { status: 500 });
    }

    const [rawRefBuf, cutoutBuf] = await Promise.all([
      refRes.arrayBuffer().then((ab) => Buffer.from(ab)),
      cutoutRes.arrayBuffer().then((ab) => Buffer.from(ab)),
    ]);

    // Apply background crop if specified — pad non-16:9 crops with edge colors
    let refBuf: Buffer = rawRefBuf;
    if (bgCrop && bgCrop.w > 0 && bgCrop.h > 0) {
      const cropW = Math.round(bgCrop.w);
      const cropH = Math.round(bgCrop.h);

      // Extract the selected region
      const cropped = await sharp(rawRefBuf)
        .extract({
          left: Math.round(bgCrop.x),
          top: Math.round(bgCrop.y),
          width: cropW,
          height: cropH,
        })
        .toBuffer();

      const TARGET_AR = 16 / 9;
      const cropAR = cropW / cropH;

      if (Math.abs(cropAR - TARGET_AR) > 0.01) {
        // Need padding — sample dominant edge color via sharp stats on a 1px border strip
        let padTop = 0,
          padBottom = 0,
          padLeft = 0,
          padRight = 0;

        if (cropAR > TARGET_AR) {
          // Wider than 16:9 → pad top/bottom
          const targetH = Math.round(cropW / TARGET_AR);
          const totalPad = targetH - cropH;
          padTop = Math.round(totalPad / 2);
          padBottom = totalPad - padTop;
        } else {
          // Taller than 16:9 → pad left/right
          const targetW = Math.round(cropH * TARGET_AR);
          const totalPad = targetW - cropW;
          padLeft = Math.round(totalPad / 2);
          padRight = totalPad - padLeft;
        }

        // Sample the dominant color from the edges of the cropped image
        const { dominant } = await sharp(cropped).stats();
        const bgColor = { r: dominant.r, g: dominant.g, b: dominant.b, alpha: 255 };

        refBuf = await sharp(cropped)
          .extend({
            top: padTop,
            bottom: padBottom,
            left: padLeft,
            right: padRight,
            background: bgColor,
          })
          .toBuffer();
      } else {
        refBuf = cropped;
      }
    }

    // Composite with sharp
    const composited = await compositeThumbnailSharp(refBuf, cutoutBuf, pos, sz);

    // Upload to S3
    const region = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-2';
    const bucket = process.env.S3_BUCKET || 'clips-genie-uploads';
    const s3 = new S3Client({ region });
    const s3Key = `compositions/${id}/thumbnails/${randomUUID()}.png`;

    const upload = new Upload({
      client: s3,
      params: {
        Bucket: bucket,
        Key: s3Key,
        Body: composited,
        ContentType: 'image/png',
      },
    });
    await upload.done();

    const s3Url = `https://${bucket}.s3.${region}.amazonaws.com/${s3Key}`;

    // Validate bgMode
    const validBgModes = ['frame', 'ai', 'custom'] as const;
    const bg = validBgModes.includes(bgMode) ? bgMode : undefined;

    // Update composition settings + upsert the selected thumbnail
    await prisma.$transaction([
      prisma.composition.update({
        where: { id },
        data: {
          thumbnailCutoutPosition: pos,
          thumbnailCutoutSize: sz,
          ...(bg && { thumbnailBgMode: bg }),
          thumbnailBgCrop: bgCrop ? JSON.stringify(bgCrop) : null,
        },
      }),
      prisma.compositionThumbnail.updateMany({
        where: { compositionId: id },
        data: { selected: false },
      }),
    ]);

    // Delete old unselected thumbnails (keep only the new one)
    await prisma.compositionThumbnail.deleteMany({
      where: { compositionId: id, selected: false },
    });

    const thumb = await prisma.compositionThumbnail.create({
      data: {
        compositionId: id,
        s3Key,
        s3Url,
        hookText: '',
        frameTimestampS: refAsset.frameTimestampS,
        visionScore: refAsset.visionScore,
        selected: true,
      },
    });

    return NextResponse.json({ id: thumb.id, s3Url });
  } catch (err) {
    console.error('[POST /api/compositions/[id]/thumbnails/composite]', err);
    return NextResponse.json({ error: 'Failed to composite thumbnail' }, { status: 500 });
  }
}
