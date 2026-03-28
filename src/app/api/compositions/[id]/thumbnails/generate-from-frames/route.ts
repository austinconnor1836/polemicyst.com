import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { queueThumbnailGenerationJob } from '@shared/queues';
import { makeS3v3Client, S3_BUCKET, S3_REGION } from '@/lib/s3-client';

/**
 * POST /api/compositions/[id]/thumbnails/generate-from-frames
 *
 * Accepts pre-extracted frame images (FormData), uploads them to S3,
 * and queues thumbnail generation using the full moondream + rembg pipeline.
 *
 * Used when source videos are local (client-side rendering) and haven't
 * been uploaded to S3, so FFmpeg-based frame extraction isn't possible.
 *
 * FormData fields:
 *   referenceFrames  — File[] of reference video frame images
 *   refTimestamps    — JSON string: number[] of timestamps matching referenceFrames
 *   creatorFrames    — File[] of creator video frame images
 *   creatorTimestamps — JSON string: number[] of timestamps matching creatorFrames
 */
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

    const formData = await req.formData();

    // Parse timestamps
    const refTimestampsRaw = formData.get('refTimestamps');
    const creatorTimestampsRaw = formData.get('creatorTimestamps');
    const refTimestamps: number[] = refTimestampsRaw ? JSON.parse(refTimestampsRaw as string) : [];
    const creatorTimestamps: number[] = creatorTimestampsRaw
      ? JSON.parse(creatorTimestampsRaw as string)
      : [];

    // Collect frame files
    const refFrameFiles = formData.getAll('referenceFrames') as File[];
    const creatorFrameFiles = formData.getAll('creatorFrames') as File[];

    if (refFrameFiles.length === 0 && creatorFrameFiles.length === 0) {
      return NextResponse.json({ error: 'No frame images provided' }, { status: 400 });
    }

    const s3 = makeS3v3Client();

    // Upload reference frames to S3
    const preExtractedReferenceFrames: Array<{ s3Url: string; timestampS: number }> = [];
    for (let i = 0; i < refFrameFiles.length; i++) {
      const file = refFrameFiles[i];
      const buffer = Buffer.from(await file.arrayBuffer());
      const s3Key = `compositions/${id}/frames/ref_${randomUUID()}.jpg`;

      await s3.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: buffer,
          ContentType: file.type || 'image/jpeg',
        })
      );

      preExtractedReferenceFrames.push({
        s3Url: `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${s3Key}`,
        timestampS: refTimestamps[i] ?? i,
      });
    }

    // Upload creator frames to S3
    const preExtractedCreatorFrames: Array<{ s3Url: string; timestampS: number }> = [];
    for (let i = 0; i < creatorFrameFiles.length; i++) {
      const file = creatorFrameFiles[i];
      const buffer = Buffer.from(await file.arrayBuffer());
      const s3Key = `compositions/${id}/frames/creator_${randomUUID()}.jpg`;

      await s3.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: buffer,
          ContentType: file.type || 'image/jpeg',
        })
      );

      preExtractedCreatorFrames.push({
        s3Url: `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${s3Key}`,
        timestampS: creatorTimestamps[i] ?? i,
      });
    }

    console.log(
      `[generate-from-frames] Uploaded ${preExtractedReferenceFrames.length} ref + ${preExtractedCreatorFrames.length} creator frames for ${id}`
    );

    // Delete old assets so the UI poll starts clean
    await prisma.thumbnailAsset.deleteMany({ where: { compositionId: id } });

    // Queue thumbnail generation with pre-extracted frames
    await queueThumbnailGenerationJob({
      compositionId: id,
      userId: user.id,
      preExtractedReferenceFrames:
        preExtractedReferenceFrames.length > 0 ? preExtractedReferenceFrames : undefined,
      preExtractedCreatorFrames:
        preExtractedCreatorFrames.length > 0 ? preExtractedCreatorFrames : undefined,
    });

    return NextResponse.json({
      success: true,
      message: 'Frames uploaded, thumbnail generation queued',
      refFrames: preExtractedReferenceFrames.length,
      creatorFrames: preExtractedCreatorFrames.length,
    });
  } catch (err) {
    console.error('[POST /api/compositions/[id]/thumbnails/generate-from-frames]', err);
    return NextResponse.json({ error: 'Failed to process frame uploads' }, { status: 500 });
  }
}
