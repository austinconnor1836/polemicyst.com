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
      subscriptionPlan: true,
      stripeCustomerId: true,
      _count: { select: { videoFeeds: true } },
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const plan = resolvePlan(user.subscriptionPlan);

  return NextResponse.json({
    plan: {
      id: plan.id,
      name: plan.name,
      limits: plan.limits,
      features: plan.features,
    },
    usage: {
      feeds: user._count.videoFeeds,
    },
    hasStripeCustomer: !!user.stripeCustomerId,
  });
}
