// src/app/api/feedVideos/route.ts
import { prisma } from '@shared/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';

export async function GET(req: NextRequest) {
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
}
