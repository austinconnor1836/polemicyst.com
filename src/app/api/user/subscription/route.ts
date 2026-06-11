import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { resolvePlan } from '@/lib/plans';

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Re-fetch with needed relations (getAuthenticatedUser returns a plain User)
  const userWithRelations = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      subscriptionPlan: true,
      stripeCustomerId: true,
      _count: { select: { videoFeeds: true } },
    },
  });

  if (!userWithRelations) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const plan = resolvePlan(userWithRelations.subscriptionPlan);

  // Count clips generated this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const clipsThisMonth = await prisma.video.count({
    where: {
      userId: userWithRelations.id,
      sourceVideoId: { not: null },
      createdAt: { gte: startOfMonth },
    },
  });

  // Upload-minutes meter: canonical usage signal for the upload-minutes pricing
  // model. Pulled from `UsageMonth.processedMinutes`, which the clip pipeline
  // increments once per processed source video. Zero when no row exists yet.
  const now = new Date();
  const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  let uploadMinutesUsed = 0;
  try {
    const usageRow = await prisma.usageMonth.findUnique({
      where: { userId_yearMonth: { userId: userWithRelations.id, yearMonth } },
      select: { processedMinutes: true },
    });
    uploadMinutesUsed = usageRow?.processedMinutes ?? 0;
  } catch {
    // UsageMonth table may not exist yet in some environments
  }
  const uploadMinutesLimit = plan.limits.uploadMinutesPerMonth;

  // Cost tracking summary for the current month
  let costThisMonth: { totalUsd: number; eventCount: number } = { totalUsd: 0, eventCount: 0 };
  try {
    const costAgg = await prisma.costEvent.aggregate({
      where: { userId: userWithRelations.id, createdAt: { gte: startOfMonth } },
      _sum: { estimatedCostUsd: true },
      _count: true,
    });
    costThisMonth = {
      totalUsd: costAgg._sum.estimatedCostUsd ?? 0,
      eventCount: costAgg._count,
    };
  } catch {
    // CostEvent table may not exist yet in some environments
  }

  return NextResponse.json({
    plan: {
      id: plan.id,
      name: plan.name,
      limits: plan.limits,
      features: plan.features,
    },
    usage: {
      feeds: userWithRelations._count.videoFeeds,
      uploadMinutesUsed,
      uploadMinutesLimit,
      clipsThisMonth,
      costThisMonth,
    },
    hasStripeCustomer: !!userWithRelations.stripeCustomerId,
  });
}
