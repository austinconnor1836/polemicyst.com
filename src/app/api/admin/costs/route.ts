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

  const days = Math.min(Number(req.nextUrl.searchParams.get('days') || '30'), 365);
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Total cost
  const totalAgg = await prisma.costEvent.aggregate({
    where: { createdAt: { gte: since } },
    _sum: { estimatedCostUsd: true },
    _count: true,
  });

  // By stage
  const byStage = await prisma.costEvent.groupBy({
    by: ['stage'],
    where: { createdAt: { gte: since } },
    _sum: { estimatedCostUsd: true, inputTokens: true, outputTokens: true },
    _avg: { durationMs: true },
    _count: true,
  });

  // By job (last 20)
  const byJobRaw = await prisma.costEvent.groupBy({
    by: ['jobId'],
    where: { createdAt: { gte: since } },
    _sum: { estimatedCostUsd: true },
    _count: true,
    _min: { createdAt: true },
    orderBy: { _min: { createdAt: 'desc' } },
    take: 20,
  });

  // Daily totals — use raw SQL for date truncation
  const dailyRaw = await prisma.$queryRaw<
    Array<{ day: Date; total_cost: number; event_count: bigint }>
  >`
    SELECT
      DATE_TRUNC('day', "createdAt") AS day,
      SUM("estimatedCostUsd") AS total_cost,
      COUNT(*) AS event_count
    FROM "CostEvent"
    WHERE "createdAt" >= ${since}
    GROUP BY DATE_TRUNC('day', "createdAt")
    ORDER BY day DESC
    LIMIT 60
  `;

  return NextResponse.json({
    totalUsd: totalAgg._sum.estimatedCostUsd ?? 0,
    totalEvents: totalAgg._count,
    days,
    byStage: byStage.map((s) => ({
      stage: s.stage,
      totalCostUsd: s._sum.estimatedCostUsd ?? 0,
      totalInputTokens: s._sum.inputTokens ?? 0,
      totalOutputTokens: s._sum.outputTokens ?? 0,
      avgDurationMs: Math.round(s._avg.durationMs ?? 0),
      count: s._count,
    })),
    byJob: byJobRaw.map((j) => ({
      jobId: j.jobId,
      totalCostUsd: j._sum.estimatedCostUsd ?? 0,
      eventCount: j._count,
      createdAt: j._min.createdAt,
    })),
    daily: dailyRaw.map((d) => ({
      day: d.day,
      totalCostUsd: Number(d.total_cost) || 0,
      eventCount: Number(d.event_count) || 0,
    })),
  });
}
