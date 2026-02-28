import { prisma } from '@shared/lib/prisma';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../auth';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const videos = await prisma.feedVideo.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    include: { feed: true },
  });
  return NextResponse.json(videos);
}
