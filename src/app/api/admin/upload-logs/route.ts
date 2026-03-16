import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { isAdmin } from '@shared/lib/admin';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!isAdmin(user?.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const days = Math.min(Number(searchParams.get('days') || '7'), 365);
  const stage = searchParams.get('stage') || undefined;
  const status = searchParams.get('status') || undefined;
  const userId = searchParams.get('userId') || undefined;
  const uploadId = searchParams.get('uploadId') || undefined;
  const limit = Math.min(Number(searchParams.get('limit') || '200'), 500);
  const offset = Number(searchParams.get('offset') || '0');

  const since = new Date();
  since.setDate(since.getDate() - days);

  const where: Record<string, unknown> = { createdAt: { gte: since } };
  if (stage) where.stage = stage;
  if (status) where.status = status;
  if (userId) where.userId = userId;
  if (uploadId) where.uploadId = uploadId;

  const [logs, total] = await Promise.all([
    prisma.uploadLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
      },
    }),
    prisma.uploadLog.count({ where }),
  ]);

  const summary = await prisma.uploadLog.groupBy({
    by: ['stage', 'status'],
    where: { createdAt: { gte: since } },
    _count: true,
  });

  const recentFailures = await prisma.uploadLog.findMany({
    where: {
      status: 'failed',
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      user: {
        select: { id: true, email: true, name: true },
      },
    },
  });

  return NextResponse.json({
    logs,
    total,
    limit,
    offset,
    days,
    summary: summary.map((s) => ({
      stage: s.stage,
      status: s.status,
      count: s._count,
    })),
    recentFailures,
  });
}
