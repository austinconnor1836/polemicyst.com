import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { generateAiBackgrounds } from '@shared/util/thumbnailGenerator';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { randomUUID } from 'crypto';

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

    // Accept optional referenceAssetId to use a specific frame
    let referenceAssetId: string | undefined;
    try {
      const body = await req.json();
      referenceAssetId = body.referenceAssetId;
    } catch {
      // No body or invalid JSON — use best-scored frame
    }

    // Find the reference frame to use as source
    let refAsset;
    if (referenceAssetId) {
      refAsset = await prisma.thumbnailAsset.findFirst({
        where: { id: referenceAssetId, compositionId: id, type: 'reference' },
      });
    }
    if (!refAsset) {
      // Fall back to highest visionScore reference frame
      refAsset = await prisma.thumbnailAsset.findFirst({
        where: { compositionId: id, type: 'reference' },
        orderBy: { visionScore: 'desc' },
      });
    }

    if (!refAsset) {
      return NextResponse.json(
        { error: 'No reference frames available. Generate thumbnails first.' },
        { status: 400 }
      );
    }

    // Download the reference frame from S3
    const frameRes = await fetch(refAsset.s3Url);
    if (!frameRes.ok) {
      return NextResponse.json({ error: 'Failed to download reference frame' }, { status: 500 });
    }
    const frameBuffer = Buffer.from(await frameRes.arrayBuffer());

    // Generate 4 styled AI backgrounds
    const aiResults = await generateAiBackgrounds(frameBuffer);

    // Upload to S3
    const region = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-2';
    const bucket = process.env.S3_BUCKET || 'clips-genie-uploads';
    const s3 = new S3Client({ region });

    const uploadPromises = aiResults.map(async ({ buffer, style }) => {
      const s3Key = `compositions/${id}/assets/ai_bg_${style}_${randomUUID()}.png`;
      const upload = new Upload({
        client: s3,
        params: {
          Bucket: bucket,
          Key: s3Key,
          Body: buffer,
          ContentType: 'image/png',
        },
      });
      await upload.done();
      const s3Url = `https://${bucket}.s3.${region}.amazonaws.com/${s3Key}`;
      return { s3Key, s3Url, style };
    });

    const uploaded = await Promise.all(uploadPromises);

    // Delete existing ai_background assets for this composition
    await prisma.thumbnailAsset.deleteMany({
      where: { compositionId: id, type: 'ai_background' },
    });

    // Create new ThumbnailAsset records
    const assets = await Promise.all(
      uploaded.map(({ s3Key, s3Url, style }) =>
        prisma.thumbnailAsset.create({
          data: {
            compositionId: id,
            type: 'ai_background',
            s3Key,
            s3Url,
            frameTimestampS: refAsset!.frameTimestampS,
            visionScore: refAsset!.visionScore,
            styleVariant: style,
          },
        })
      )
    );

    return NextResponse.json({ assets });
  } catch (err) {
    console.error('[POST /api/compositions/[id]/thumbnails/ai-backgrounds]', err);
    return NextResponse.json({ error: 'Failed to generate AI backgrounds' }, { status: 500 });
  }
}
