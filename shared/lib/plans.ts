import { prisma } from './prisma';

export type PlanId = 'free' | 'pro' | 'business';

export interface PlanLimits {
  maxConnectedAccounts: number;
  maxClipsPerMonth: number;
  maxStorageGb: number;
  llmProviders: string[];
  autoGenerateClips: boolean;
  prioritySupport: boolean;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  description: string;
  monthlyPriceDisplay: string;
  limits: PlanLimits;
  features: string[];
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    description: 'Get started with basic clip generation',
    monthlyPriceDisplay: '$0',
    limits: {
      maxConnectedAccounts: 2,
      maxClipsPerMonth: 10,
      maxStorageGb: 1,
      llmProviders: ['ollama'],
      autoGenerateClips: false,
      prioritySupport: false,
    },
    features: ['2 connected accounts', '10 clips/month', '1 GB storage', 'Ollama LLM only'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    description: 'For creators who need more power',
    monthlyPriceDisplay: '$19',
    limits: {
      maxConnectedAccounts: 10,
      maxClipsPerMonth: 100,
      maxStorageGb: 25,
      llmProviders: ['ollama', 'gemini'],
      autoGenerateClips: true,
      prioritySupport: false,
    },
    features: [
      '10 connected accounts',
      '100 clips/month',
      '25 GB storage',
      'Ollama + Gemini LLM',
      'Auto-generate clips',
    ],
  },
  business: {
    id: 'business',
    name: 'Business',
    description: 'For teams and high-volume creators',
    monthlyPriceDisplay: '$49',
    limits: {
      maxConnectedAccounts: 50,
      maxClipsPerMonth: 500,
      maxStorageGb: 100,
      llmProviders: ['ollama', 'gemini', 'openai', 'anthropic'],
      autoGenerateClips: true,
      prioritySupport: true,
    },
    features: [
      '50 connected accounts',
      '500 clips/month',
      '100 GB storage',
      'All LLM providers',
      'Auto-generate clips',
      'Priority support',
    ],
  },
};

export function resolvePlan(subscriptionPlan?: string | null): PlanDefinition {
  if (subscriptionPlan && subscriptionPlan in PLANS) {
    return PLANS[subscriptionPlan as PlanId];
  }
  return PLANS.free;
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
  const limit = plan.limits.maxClipsPerMonth;

  return {
    allowed: currentUsage < limit,
    message:
      currentUsage >= limit
        ? `You have reached your clip limit (${limit}/month) on the ${plan.name} plan. Upgrade to generate more clips.`
        : null,
    currentUsage,
    limit,
  };
}

export function checkLlmProviderAccess(provider: string, subscriptionPlan?: string | null) {
  const plan = resolvePlan(subscriptionPlan);
  const allowed = plan.limits.llmProviders.includes(provider.toLowerCase());

  return {
    allowed,
    message: !allowed
      ? `The ${provider} LLM provider is not available on the ${plan.name} plan. Upgrade to access it.`
      : null,
    allowedProviders: plan.limits.llmProviders,
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
