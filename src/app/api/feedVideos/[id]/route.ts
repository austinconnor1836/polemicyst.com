// src/app/api/feedVideos/[id]/route.ts
import { prisma } from '@shared/lib/prisma';
import { NextResponse } from 'next/server';
import { deleteFromS3 } from 'backend/lib/s3';

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const videoId = params.id;
    console.log('Deleting video with id:', videoId);
    if (!videoId) {
      return NextResponse.json({ error: 'Missing video id' }, { status: 400 });
    }
    // Find the video record
    const video = await prisma.feedVideo.findUnique({ where: { id: videoId } });
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }
    // Extract S3 key from s3Url
    const s3Url = video.s3Url;
    const s3KeyMatch = s3Url.match(/https:\/\/[^\/]+\/(.+)/);
    const s3Key = s3KeyMatch ? s3KeyMatch[1] : null;
    if (s3Key) {
      await deleteFromS3(s3Key);
    }
    // Delete the DB record
    await prisma.feedVideo.delete({ where: { id: videoId } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error deleting video:', err);
    return NextResponse.json({ error: 'Failed to delete video' }, { status: 500 });
  }
}
