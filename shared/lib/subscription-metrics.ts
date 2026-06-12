/**
 * Subscription metrics rollup helpers (W017).
 *
 * The Stripe webhook handler calls these to keep the `SubscriptionMetric`
 * daily-rollup table fresh as subscriptions are created / changed / canceled.
 *
 * The rollup is non-fatal: every helper swallows errors so a hiccup in the
 * metrics layer cannot crash a webhook delivery. Stripe will retry failed
 * deliveries but we never want a metric write to be the cause.
 */

import { prisma } from './prisma';
import type { PlanId } from './plans';
import { PLANS } from './plans';

export type SubscriptionInterval = 'monthly' | 'annual' | 'unknown';

/** Returns today's UTC midnight as a Date — the rollup row's natural key. */
export function todayUtcMidnight(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

/** Parse a display price like "$19" into integer dollars. Returns 0 if unparseable. */
function parseDisplayDollars(display: string): number {
  const n = Number(display.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Monthly-equivalent cents for a plan. Falls back to the display price when no
 * Stripe amount is available (which is the case for the safety-net branch of
 * the webhook that doesn't have the live invoice in hand).
 *
 * The pricing module marks every dollar figure as a TODO pending WTP research,
 * so this is intentionally a best-effort approximation for the rollup.
 */
export function monthlyCentsForPlan(planId: PlanId): number {
  const def = PLANS[planId];
  if (!def) return 0;
  return parseDisplayDollars(def.monthlyPriceDisplay) * 100;
}

/**
 * Convert a Stripe subscription amount-in-cents + interval into a
 * monthly-equivalent cents figure. Annual prices are spread across 12 months
 * so MRR remains comparable.
 */
export function monthlyEquivalentCents(
  amountCents: number | null | undefined,
  interval: SubscriptionInterval
): number {
  const safe = typeof amountCents === 'number' && Number.isFinite(amountCents) ? amountCents : 0;
  if (safe <= 0) return 0;
  if (interval === 'annual') return Math.round(safe / 12);
  return safe;
}

/** Per-plan counter column on the rollup row. */
function planCounterField(planId: PlanId): 'creatorCount' | 'proCount' | 'agencyCount' | null {
  if (planId === 'creator') return 'creatorCount';
  if (planId === 'pro') return 'proCount';
  if (planId === 'agency') return 'agencyCount';
  return null;
}

interface ApplyArgs {
  planId: PlanId;
  /** Monthly-equivalent cents the subscription contributes to MRR. */
  monthlyCents: number;
  /** When true, also bumps the `newSubscriptions` counter. */
  countAsNew?: boolean;
}

/**
 * Apply a subscription START to today's rollup row.
 * Upserts the row if it does not yet exist, then increments active counts,
 * per-plan counter, optionally `newSubscriptions`, and adds to MRR/ARR.
 */
export async function applySubscriptionStart({
  planId,
  monthlyCents,
  countAsNew = true,
}: ApplyArgs): Promise<void> {
  const counter = planCounterField(planId);
  if (!counter) return; // free / unknown plans don't move the needle
  const date = todayUtcMidnight();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.subscriptionMetric.upsert({
        where: { date },
        create: {
          date,
          mrrCents: monthlyCents,
          arrCents: monthlyCents * 12,
          activeSubscriptions: 1,
          [counter]: 1,
          newSubscriptions: countAsNew ? 1 : 0,
        } as Parameters<typeof tx.subscriptionMetric.upsert>[0]['create'],
        update: {
          mrrCents: { increment: monthlyCents },
          arrCents: { increment: monthlyCents * 12 },
          activeSubscriptions: { increment: 1 },
          [counter]: { increment: 1 },
          newSubscriptions: countAsNew ? { increment: 1 } : undefined,
        } as Parameters<typeof tx.subscriptionMetric.upsert>[0]['update'],
      });
    });
  } catch (err) {
    console.error('[subscription-metrics] applySubscriptionStart failed', err);
  }
}

/**
 * Apply a subscription END (cancellation) to today's rollup row.
 * Decrements active counts and the per-plan counter, increments the
 * `churnedSubscriptions` counter, and subtracts from MRR/ARR.
 */
export async function applySubscriptionEnd({
  planId,
  monthlyCents,
}: Omit<ApplyArgs, 'countAsNew'>): Promise<void> {
  const counter = planCounterField(planId);
  if (!counter) return;
  const date = todayUtcMidnight();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.subscriptionMetric.upsert({
        where: { date },
        create: {
          date,
          mrrCents: -monthlyCents,
          arrCents: -monthlyCents * 12,
          activeSubscriptions: -1,
          [counter]: -1,
          churnedSubscriptions: 1,
        } as Parameters<typeof tx.subscriptionMetric.upsert>[0]['create'],
        update: {
          mrrCents: { decrement: monthlyCents },
          arrCents: { decrement: monthlyCents * 12 },
          activeSubscriptions: { decrement: 1 },
          [counter]: { decrement: 1 },
          churnedSubscriptions: { increment: 1 },
        } as Parameters<typeof tx.subscriptionMetric.upsert>[0]['update'],
      });
    });
  } catch (err) {
    console.error('[subscription-metrics] applySubscriptionEnd failed', err);
  }
}

interface PlanChangeArgs {
  oldPlanId: PlanId;
  newPlanId: PlanId;
  oldMonthlyCents: number;
  newMonthlyCents: number;
}

/**
 * Apply a subscription PLAN CHANGE (upgrade / downgrade) to today's rollup row.
 * Active subscription count is unchanged — we just move one slot from the old
 * plan counter to the new and adjust MRR by the cents delta.
 */
export async function applySubscriptionPlanChange({
  oldPlanId,
  newPlanId,
  oldMonthlyCents,
  newMonthlyCents,
}: PlanChangeArgs): Promise<void> {
  if (oldPlanId === newPlanId && oldMonthlyCents === newMonthlyCents) return;
  const oldCounter = planCounterField(oldPlanId);
  const newCounter = planCounterField(newPlanId);
  const deltaCents = newMonthlyCents - oldMonthlyCents;
  const date = todayUtcMidnight();

  try {
    await prisma.$transaction(async (tx) => {
      const update: Record<string, unknown> = {
        mrrCents: { increment: deltaCents },
        arrCents: { increment: deltaCents * 12 },
      };
      if (oldCounter && oldCounter !== newCounter) {
        update[oldCounter] = { decrement: 1 };
      }
      if (newCounter && oldCounter !== newCounter) {
        update[newCounter] = { increment: 1 };
      }

      const create: Record<string, unknown> = {
        date,
        mrrCents: deltaCents,
        arrCents: deltaCents * 12,
      };
      if (oldCounter && oldCounter !== newCounter) {
        create[oldCounter] = -1;
      }
      if (newCounter && oldCounter !== newCounter) {
        create[newCounter] = 1;
      }

      await tx.subscriptionMetric.upsert({
        where: { date },
        create: create as Parameters<typeof tx.subscriptionMetric.upsert>[0]['create'],
        update: update as Parameters<typeof tx.subscriptionMetric.upsert>[0]['update'],
      });
    });
  } catch (err) {
    console.error('[subscription-metrics] applySubscriptionPlanChange failed', err);
  }
}
