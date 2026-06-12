import { prisma } from './prisma';

export type PlanId = 'free' | 'creator' | 'pro' | 'agency';

export interface PlanLimits {
  maxConnectedAccounts: number;
  /** PRIMARY value metric — source video minutes processed per month. */
  uploadMinutesPerMonth: number;
  maxStorageGb: number;
  /** When true, rendered clips are watermarked (free tier). */
  watermark: boolean;
  autoGenerateClips: boolean;
  /** Number of team seats included. 1 = solo. */
  teamSeats: number;
  prioritySupport: boolean;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  description: string;
  monthlyPriceDisplay: string;
  /** Per-month price when billed annually. */
  annualPriceDisplay: string;
  limits: PlanLimits;
  features: string[];
}

// NOTE(pricing): All dollar amounts and minute limits below are PLACEHOLDERS sourced from
// docs/PRICING_STRATEGY.md. They are owned by the separate pricing/WTP agent — do not treat
// them as final. The *structure* (tiers, fields, metric) is what this module establishes.
export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    description: 'Try Clipfire with watermarked clips',
    monthlyPriceDisplay: '$0', // TODO(pricing): confirm
    annualPriceDisplay: '$0', // TODO(pricing): confirm
    limits: {
      maxConnectedAccounts: 1,
      uploadMinutesPerMonth: 60, // TODO(pricing): confirm via WTP
      maxStorageGb: 1,
      watermark: true,
      autoGenerateClips: false,
      teamSeats: 1,
      prioritySupport: false,
    },
    features: [
      '1 connected account',
      '60 upload minutes/month',
      'Best-in-class AI scoring',
      'Watermarked clips',
    ],
  },
  creator: {
    id: 'creator',
    name: 'Creator',
    description: 'For solo creators getting started',
    monthlyPriceDisplay: '$19', // TODO(pricing): confirm via WTP
    annualPriceDisplay: '$15', // TODO(pricing): confirm via WTP
    limits: {
      maxConnectedAccounts: 3,
      uploadMinutesPerMonth: 600, // TODO(pricing): confirm via WTP
      maxStorageGb: 25,
      watermark: false,
      autoGenerateClips: true,
      teamSeats: 1,
      prioritySupport: false,
    },
    features: [
      '3 connected accounts',
      '600 upload minutes/month',
      'No watermark',
      'Auto-generate clips',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    description: 'For power creators who post daily',
    monthlyPriceDisplay: '$39', // TODO(pricing): confirm via WTP
    annualPriceDisplay: '$31', // TODO(pricing): confirm via WTP
    limits: {
      maxConnectedAccounts: 10,
      uploadMinutesPerMonth: 1800, // TODO(pricing): confirm via WTP
      maxStorageGb: 50,
      watermark: false,
      autoGenerateClips: true,
      teamSeats: 1,
      prioritySupport: true,
    },
    features: [
      '10 connected accounts',
      '1,800 upload minutes/month',
      'No watermark',
      'Auto-generate clips',
      'Priority support',
    ],
  },
  agency: {
    id: 'agency',
    name: 'Agency',
    description: 'For teams and high-volume creators',
    monthlyPriceDisplay: '$99', // TODO(pricing): confirm via WTP
    annualPriceDisplay: '$79', // TODO(pricing): confirm via WTP
    limits: {
      maxConnectedAccounts: 30,
      uploadMinutesPerMonth: 6000, // TODO(pricing): confirm via WTP
      maxStorageGb: 200,
      watermark: false,
      autoGenerateClips: true,
      teamSeats: 5, // TODO(pricing): confirm via WTP
      prioritySupport: true,
    },
    features: [
      '30 connected accounts',
      '6,000 upload minutes/month',
      'Team seats',
      'No watermark',
      'Auto-generate clips',
      'Priority support',
    ],
  },
};

/**
 * Resolve a stored subscription plan string to a plan definition.
 * Maps legacy plan ids (`business`) to their current equivalents so existing
 * subscribers keep working after the restructure.
 */
export function resolvePlan(subscriptionPlan?: string | null): PlanDefinition {
  if (!subscriptionPlan) return PLANS.free;
  // Legacy mapping: the old `business` tier becomes `agency`.
  const normalized = subscriptionPlan === 'business' ? 'agency' : subscriptionPlan;
  if (normalized in PLANS) {
    return PLANS[normalized as PlanId];
  }
  return PLANS.free;
}

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function checkFeedQuota(userId: string, subscriptionPlan?: string | null) {
  const plan = resolvePlan(subscriptionPlan);
  const currentUsage = await prisma.videoFeed.count({
    where: { userId, sourceType: { not: 'manual' } },
  });
  const limit = plan.limits.maxConnectedAccounts;

  return {
    allowed: currentUsage < limit,
    message:
      currentUsage >= limit
        ? `You have reached your connected accounts limit (${limit}) on the ${plan.name} plan. Upgrade to add more.`
        : null,
    currentUsage,
    limit,
  };
}

/**
 * PRIMARY quota check — gates on source video minutes processed this month,
 * read from the `UsageMonth` rollup. Replaces the legacy clip-count quota.
 */
export async function checkUploadMinutesQuota(userId: string, subscriptionPlan?: string | null) {
  const plan = resolvePlan(subscriptionPlan);
  const limit = plan.limits.uploadMinutesPerMonth;

  const usage = await prisma.usageMonth.findUnique({
    where: { userId_yearMonth: { userId, yearMonth: currentYearMonth() } },
    select: { processedMinutes: true },
  });
  const currentUsage = Math.round(usage?.processedMinutes ?? 0);

  return {
    allowed: currentUsage < limit,
    message:
      currentUsage >= limit
        ? `You have reached your upload limit (${limit} minutes/month) on the ${plan.name} plan. Upgrade to process more video.`
        : null,
    currentUsage,
    limit,
  };
}

/**
 * @deprecated Superseded by {@link checkUploadMinutesQuota}. Retained so any
 * un-migrated call sites keep functioning during the pricing restructure.
 */
export async function checkClipQuota(userId: string, subscriptionPlan?: string | null) {
  const plan = resolvePlan(subscriptionPlan);
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const currentUsage = await prisma.video.count({
    where: {
      userId,
      sourceVideoId: { not: null },
      createdAt: { gte: startOfMonth },
    },
  });
  // Approximate against the new metric so a deprecated caller never hard-blocks
  // incorrectly; real enforcement lives in checkUploadMinutesQuota.
  const limit = plan.limits.uploadMinutesPerMonth;

  return {
    allowed: true,
    message: null,
    currentUsage,
    limit,
  };
}

/**
 * Quality is no longer gated by plan — every tier gets the best available scoring.
 * Retained with the original signature so existing call sites compile unchanged.
 */
export function checkLlmProviderAccess(_provider: string, _subscriptionPlan?: string | null) {
  return {
    allowed: true as const,
    message: null,
    allowedProviders: ['ollama', 'gemini', 'openai', 'anthropic'],
  };
}

export function checkAutoGenerateAccess(subscriptionPlan?: string | null) {
  const plan = resolvePlan(subscriptionPlan);
  const allowed = plan.limits.autoGenerateClips;

  return {
    allowed,
    message: !allowed
      ? `Auto-generate clips is not available on the ${plan.name} plan. Upgrade to enable it.`
      : null,
  };
}
