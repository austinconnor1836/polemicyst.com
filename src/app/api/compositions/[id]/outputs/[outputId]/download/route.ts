import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { S3_BUCKET, S3_REGION } from '@shared/lib/storage/storage-provider';

const s3 = new S3Client({ region: S3_REGION });

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; outputId: string }> }
) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, outputId } = await params;

    const composition = await prisma.composition.findFirst({
      where: { id, userId: user.id },
    });
    if (!composition) {
      return NextResponse.json({ error: 'Composition not found' }, { status: 404 });
    }

    const output = await prisma.compositionOutput.findFirst({
      where: { id: outputId, compositionId: id },
    });
    if (!output || !output.s3Key) {
      return NextResponse.json({ error: 'Output not found or not rendered' }, { status: 404 });
    }

    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: output.s3Key,
    });

    const response = await s3.send(command);

    if (!response.Body) {
      return NextResponse.json({ error: 'Empty response from S3' }, { status: 500 });
    }

    const stream = response.Body as ReadableStream;
    const headers = new Headers();
    headers.set('Content-Type', 'video/mp4');
    if (response.ContentLength) {
      headers.set('Content-Length', String(response.ContentLength));
    }
    headers.set('Content-Disposition', `attachment; filename="${output.layout}-${outputId}.mp4"`);

    return new NextResponse(stream as any, { status: 200, headers });
  } catch (err) {
    console.error('[GET /api/compositions/[id]/outputs/[outputId]/download]', err);
    return NextResponse.json({ error: 'Failed to download output' }, { status: 500 });
  }
}
