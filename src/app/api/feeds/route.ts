// src/app/api/feeds/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../auth'; // adjust path if needed

export async function GET() {
  const feeds = await prisma.videoFeed.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(feeds);
}

const PLAN_FEED_LIMITS: Record<string, number> = {
  free: 3,
  pro: 25,
  enterprise: -1,
};

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { videoFeeds: { select: { id: true } } },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const plan = user.subscriptionPlan || 'free';
  const feedLimit = PLAN_FEED_LIMITS[plan] ?? PLAN_FEED_LIMITS.free;

  if (feedLimit !== -1 && user.videoFeeds.length >= feedLimit) {
    return NextResponse.json(
      {
        code: 'QUOTA_EXCEEDED',
        message: `You have reached the feed limit (${feedLimit}) for the ${plan} plan. Upgrade to add more feeds.`,
        plan,
        limit: feedLimit,
        usage: user.videoFeeds.length,
      },
      { status: 403 },
    );
  }

  const data = await req.json();
  const { name, sourceUrl, pollingInterval } = data;

  let sourceType: 'youtube' | 'cspan' | 'other' = 'other';
  const lowerUrl = sourceUrl.toLowerCase();
  if (lowerUrl.includes('youtube.com')) sourceType = 'youtube';
  else if (lowerUrl.includes('c-span.org') || lowerUrl.includes('cspan')) sourceType = 'cspan';

  const newFeed = await prisma.videoFeed.create({
    data: {
      name,
      sourceUrl,
      pollingInterval,
      sourceType,
      userId: user.id, // ✅ required
    },
  });

  return NextResponse.json(newFeed);
}
