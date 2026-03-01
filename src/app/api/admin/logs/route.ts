import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../auth';
import { prisma } from '@shared/lib/prisma';
import { isAdmin } from '@shared/lib/admin';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user?.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const days = Math.min(Number(searchParams.get('days') || '7'), 365);
  const jobType = searchParams.get('jobType') || undefined;
  const status = searchParams.get('status') || undefined;
  const feedVideoId = searchParams.get('feedVideoId') || undefined;
  const limit = Math.min(Number(searchParams.get('limit') || '200'), 500);
  const offset = Number(searchParams.get('offset') || '0');

  const since = new Date();
  since.setDate(since.getDate() - days);

  const where: Record<string, unknown> = { createdAt: { gte: since } };
  if (jobType) where.jobType = jobType;
  if (status) where.status = status;
  if (feedVideoId) where.feedVideoId = feedVideoId;

  const [logs, total] = await Promise.all([
    prisma.jobLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        feedVideo: {
          select: { id: true, title: true, videoId: true, status: true },
        },
      },
    }),
    prisma.jobLog.count({ where }),
  ]);

  const summary = await prisma.jobLog.groupBy({
    by: ['jobType', 'status'],
    where: { createdAt: { gte: since } },
    _count: true,
  });

  return NextResponse.json({
    logs,
    total,
    limit,
    offset,
    days,
    summary: summary.map((s) => ({
      jobType: s.jobType,
      status: s.status,
      count: s._count,
    })),
  });
}
