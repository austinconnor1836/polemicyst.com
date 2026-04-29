import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { makeS3v3Client, S3_BUCKET, S3_REGION } from '@/lib/s3-client';

const MAX_BACKGROUND_BYTES = 10 * 1024 * 1024;

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

    const formData = await req.formData();
    const file = formData.get('background');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'background image required' }, { status: 400 });
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'background must be an image' }, { status: 400 });
    }
    if (file.size > MAX_BACKGROUND_BYTES) {
      return NextResponse.json({ error: 'background must be 10MB or smaller' }, { status: 400 });
    }

    const inputBuffer = Buffer.from(await file.arrayBuffer());
    const metadata = await sharp(inputBuffer, { failOn: 'none' }).metadata();
    if (!metadata.width || !metadata.height) {
      return NextResponse.json({ error: 'Invalid background image' }, { status: 400 });
    }

    const normalized = await sharp(inputBuffer, { failOn: 'none' }).rotate().png().toBuffer();
    const s3Key = `compositions/${id}/assets/custom_bg_${randomUUID()}.png`;

    await makeS3v3Client().send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: normalized,
        ContentType: 'image/png',
      })
    );

    const asset = await prisma.thumbnailAsset.create({
      data: {
        compositionId: id,
        type: 'custom_background',
        s3Key,
        s3Url: `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${s3Key}`,
        frameTimestampS: 0,
        visionScore: null,
        styleVariant: file.name || 'custom',
      },
    });

    return NextResponse.json({ asset });
  } catch (err) {
    console.error('[POST /api/compositions/[id]/thumbnails/custom-backgrounds]', err);
    return NextResponse.json({ error: 'Failed to upload custom background' }, { status: 500 });
  }
}
