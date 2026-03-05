import { prisma } from '@shared/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const videos = await prisma.feedVideo.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { feed: true },
    });
    return NextResponse.json(videos);
  } catch (err) {
    console.error('[GET /api/feedVideos] Unhandled error:', err);
    return NextResponse.json({ error: 'Failed to load feed videos' }, { status: 500 });
  }
}
