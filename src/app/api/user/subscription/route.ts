import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../auth";
import { prisma } from "@shared/lib/prisma";

const PLAN_LIMITS: Record<string, { feeds: number; clipsPerMonth: number; allowedProviders: string[] }> = {
  free: { feeds: 3, clipsPerMonth: 10, allowedProviders: ["openai"] },
  pro: { feeds: 25, clipsPerMonth: 200, allowedProviders: ["openai", "anthropic", "google"] },
  enterprise: { feeds: -1, clipsPerMonth: -1, allowedProviders: ["openai", "anthropic", "google", "ollama"] },
};

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: {
      videoFeeds: { select: { id: true } },
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const plan = user.subscriptionPlan || "free";
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const clipsThisMonth = await prisma.video.count({
    where: {
      userId: user.id,
      sourceVideoId: { not: null },
      createdAt: { gte: startOfMonth },
    },
  });

  return NextResponse.json({
    plan,
    limits: {
      feeds: limits.feeds,
      clipsPerMonth: limits.clipsPerMonth,
      allowedProviders: limits.allowedProviders,
    },
    usage: {
      feeds: user.videoFeeds.length,
      clipsThisMonth,
    },
    stripeCustomerId: user.stripeCustomerId ?? null,
    billingPortalUrl: process.env.STRIPE_BILLING_PORTAL_URL ?? null,
  });
}
