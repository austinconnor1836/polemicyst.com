import { prisma } from '@shared/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { deleteFromS3 } from '@shared/lib/s3';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';

export async function DELETE(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'Missing video id' }, { status: 400 });

    const video = await prisma.feedVideo.findUnique({ where: { id } });
    if (!video) return NextResponse.json({ error: 'Video not found' }, { status: 404 });

    if (video.userId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Try to extract the S3 key from the s3Url
    let s3Key: string | undefined;
    if (video.s3Url) {
      const urlParts = video.s3Url.split('.amazonaws.com/');
      if (urlParts.length === 2) {
        s3Key = urlParts[1];
      }
    }

    if (s3Key) {
      try {
        await deleteFromS3(s3Key);
      } catch (err) {
        // Log error but continue with DB delete
        console.error('Failed to delete from S3:', err);
      }
    }

    await prisma.feedVideo.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
