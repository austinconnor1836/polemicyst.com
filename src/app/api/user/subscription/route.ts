import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../auth';
import { prisma } from '@shared/lib/prisma';
import { resolvePlan } from '@/lib/plans';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      subscriptionPlan: true,
      stripeCustomerId: true,
      _count: { select: { videoFeeds: true } },
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const plan = resolvePlan(user.subscriptionPlan);

  // Count clips generated this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const clipsThisMonth = await prisma.video.count({
    where: {
      userId: user.id,
      sourceVideoId: { not: null },
      createdAt: { gte: startOfMonth },
    },
  });

  // Cost tracking summary for the current month
  let costThisMonth: { totalUsd: number; eventCount: number } = { totalUsd: 0, eventCount: 0 };
  try {
    const costAgg = await prisma.costEvent.aggregate({
      where: { userId: user.id, createdAt: { gte: startOfMonth } },
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
      feeds: user._count.videoFeeds,
      clipsThisMonth,
      costThisMonth,
    },
    hasStripeCustomer: !!user.stripeCustomerId,
  });
}
