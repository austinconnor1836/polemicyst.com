import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../auth';
import { prisma } from '@shared/lib/prisma';
import { cookies } from 'next/headers';
import { ANON_COOKIE } from '@/lib/anonymous-session';

/**
 * Transfers videos uploaded by an anonymous session to the newly
 * authenticated user, then deletes the anonymous user record and
 * clears the cookie.  Called by the client right after sign-in.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const realUser = await prisma.user.findUnique({
    where: { email: session.user.email },
  });

  if (!realUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const cookieStore = await cookies();
  const anonId = cookieStore.get(ANON_COOKIE)?.value;

  if (!anonId) {
    return NextResponse.json({ merged: 0 });
  }

  const anonUser = await prisma.user.findUnique({ where: { id: anonId } });

  if (!anonUser || anonUser.id === realUser.id) {
    const res = NextResponse.json({ merged: 0 });
    res.cookies.delete(ANON_COOKIE);
    return res;
  }

  const transferred = await prisma.$transaction(async (tx) => {
    const anonFeeds = await tx.videoFeed.findMany({ where: { userId: anonId } });

    let totalMoved = 0;

    for (const anonFeed of anonFeeds) {
      let targetFeed = await tx.videoFeed.findFirst({
        where: { userId: realUser.id, sourceType: anonFeed.sourceType },
      });

      if (!targetFeed) {
        targetFeed = await tx.videoFeed.create({
          data: {
            userId: realUser.id,
            name: anonFeed.name,
            sourceType: anonFeed.sourceType,
            sourceUrl: anonFeed.sourceUrl,
            pollingInterval: anonFeed.pollingInterval,
          },
        });
      }

      const videos = await tx.feedVideo.findMany({ where: { feedId: anonFeed.id } });

      for (const video of videos) {
        const exists = await tx.feedVideo.findFirst({
          where: { feedId: targetFeed.id, videoId: video.videoId },
        });
        if (exists) continue;

        await tx.feedVideo.update({
          where: { id: video.id },
          data: { feedId: targetFeed.id, userId: realUser.id },
        });
        totalMoved++;
      }

      await tx.videoFeed.delete({ where: { id: anonFeed.id } });
    }

    await tx.user.delete({ where: { id: anonId } }).catch(() => {});

    return totalMoved;
  });

  const res = NextResponse.json({ merged: transferred });
  res.cookies.delete(ANON_COOKIE);
  return res;
}
