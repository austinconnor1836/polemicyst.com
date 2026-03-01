import { prisma } from '@shared/lib/prisma';
import { NextResponse } from 'next/server';
import { resolveUser, withAnonCookie } from '@/lib/anonymous-session';

export async function GET() {
  const { user, newAnonId } = await resolveUser();

  const videos = await prisma.feedVideo.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    include: { feed: true },
  });
  return withAnonCookie(NextResponse.json(videos), newAnonId);
}
