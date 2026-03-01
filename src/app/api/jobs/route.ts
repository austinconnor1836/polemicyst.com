import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const days = Math.min(Number(searchParams.get('days') || '7'), 90);
  const jobType = searchParams.get('jobType') || undefined;
  const status = searchParams.get('status') || undefined;

  const since = new Date();
  since.setDate(since.getDate() - days);

  const where: Record<string, unknown> = {
    createdAt: { gte: since },
    feedVideo: { userId: user.id },
  };
  if (jobType) where.jobType = jobType;
  if (status) where.status = status;

  const [logs, summary, activeVideos] = await Promise.all([
    prisma.jobLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        feedVideo: {
          select: {
            id: true,
            title: true,
            videoId: true,
            status: true,
            clipGenerationStatus: true,
            thumbnailUrl: true,
            feed: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.jobLog.groupBy({
      by: ['jobType', 'status'],
      where: { createdAt: { gte: since }, feedVideo: { userId: user.id } },
      _count: true,
    }),
    prisma.feedVideo.findMany({
      where: {
        userId: user.id,
        clipGenerationStatus: { in: ['queued', 'processing'] },
      },
      select: {
        id: true,
        title: true,
        clipGenerationStatus: true,
        thumbnailUrl: true,
        feed: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return NextResponse.json({
    logs,
    activeVideos,
    summary: summary.map((s) => ({
      jobType: s.jobType,
      status: s.status,
      count: s._count,
    })),
  });
}
