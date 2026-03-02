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
      clipsThisMonth,
      costThisMonth,
    },
    hasStripeCustomer: !!userWithRelations.stripeCustomerId,
  });
}
