import { prisma } from '@shared/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const feedVideo = await prisma.feedVideo.findUnique({
    where: { id: params.id },
    include: {
      feed: true,
      generatedClips: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!feedVideo) {
    return NextResponse.json({ error: 'Feed video not found' }, { status: 404 });
  }

  return NextResponse.json(feedVideo);
}
