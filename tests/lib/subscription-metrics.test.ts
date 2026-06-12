import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@shared/lib/prisma', () => {
  const subscriptionMetricUpsert = vi.fn().mockResolvedValue(undefined);
  const transactionImpl = vi.fn(async (fn: (tx: unknown) => unknown) => {
    if (typeof fn === 'function') {
      return fn({ subscriptionMetric: { upsert: subscriptionMetricUpsert } });
    }
    return fn;
  });
  return {
    prisma: {
      $transaction: transactionImpl,
      subscriptionMetric: { upsert: subscriptionMetricUpsert },
    },
  };
});

import {
  applySubscriptionStart,
  applySubscriptionEnd,
  applySubscriptionPlanChange,
  monthlyCentsForPlan,
  monthlyEquivalentCents,
} from '@shared/lib/subscription-metrics';
import { prisma } from '@shared/lib/prisma';

const mockedUpsert = (
  prisma as unknown as {
    subscriptionMetric: { upsert: ReturnType<typeof vi.fn> };
  }
).subscriptionMetric.upsert;

describe('subscription-metrics helpers', () => {
  beforeEach(() => {
    mockedUpsert.mockClear();
    mockedUpsert.mockResolvedValue(undefined);
  });

  describe('monthlyEquivalentCents', () => {
    it('treats annual interval as amount / 12', () => {
      expect(monthlyEquivalentCents(12000, 'annual')).toBe(1000);
    });
    it('returns monthly amount unchanged', () => {
      expect(monthlyEquivalentCents(1900, 'monthly')).toBe(1900);
    });
    it('coerces null / zero / unknown to 0', () => {
      expect(monthlyEquivalentCents(null, 'monthly')).toBe(0);
      expect(monthlyEquivalentCents(undefined, 'annual')).toBe(0);
      expect(monthlyEquivalentCents(0, 'unknown')).toBe(0);
    });
  });

  describe('monthlyCentsForPlan', () => {
    it('returns 0 for the free tier', () => {
      expect(monthlyCentsForPlan('free')).toBe(0);
    });
    it('returns >0 for paid tiers', () => {
      expect(monthlyCentsForPlan('creator')).toBeGreaterThan(0);
      expect(monthlyCentsForPlan('pro')).toBeGreaterThan(0);
      expect(monthlyCentsForPlan('agency')).toBeGreaterThan(0);
    });
  });

  describe('applySubscriptionStart', () => {
    it('upserts the rollup with active+1, per-plan+1, new+1, and adds MRR/ARR', async () => {
      await applySubscriptionStart({
        planId: 'creator',
        monthlyCents: 1900,
        countAsNew: true,
      });

      expect(mockedUpsert).toHaveBeenCalledTimes(1);
      const args = mockedUpsert.mock.calls[0][0];
      // The create-side covers the "first webhook of the day" path.
      expect(args.create.activeSubscriptions).toBe(1);
      expect(args.create.creatorCount).toBe(1);
      expect(args.create.newSubscriptions).toBe(1);
      expect(args.create.mrrCents).toBe(1900);
      expect(args.create.arrCents).toBe(1900 * 12);
      // The update-side fires when the row exists; both branches must increment.
      expect(args.update.activeSubscriptions).toEqual({ increment: 1 });
      expect(args.update.creatorCount).toEqual({ increment: 1 });
      expect(args.update.mrrCents).toEqual({ increment: 1900 });
    });

    it('skips the rollup entirely for the free / unknown plan', async () => {
      // Exercise the runtime guard: 'free' is a valid PlanId but planCounterField
      // returns null for it, so no upsert should fire.
      await applySubscriptionStart({ planId: 'free', monthlyCents: 0 });
      expect(mockedUpsert).not.toHaveBeenCalled();
    });
  });

  describe('applySubscriptionEnd', () => {
    it('decrements active + per-plan, increments churned, subtracts MRR/ARR', async () => {
      await applySubscriptionEnd({ planId: 'pro', monthlyCents: 3900 });

      expect(mockedUpsert).toHaveBeenCalledTimes(1);
      const args = mockedUpsert.mock.calls[0][0];
      expect(args.create.activeSubscriptions).toBe(-1);
      expect(args.create.proCount).toBe(-1);
      expect(args.create.churnedSubscriptions).toBe(1);
      expect(args.create.mrrCents).toBe(-3900);
      expect(args.update.activeSubscriptions).toEqual({ decrement: 1 });
      expect(args.update.proCount).toEqual({ decrement: 1 });
      expect(args.update.churnedSubscriptions).toEqual({ increment: 1 });
      expect(args.update.mrrCents).toEqual({ decrement: 3900 });
    });
  });

  describe('applySubscriptionPlanChange', () => {
    it('swaps per-plan counters and adjusts MRR by the delta on an upgrade', async () => {
      await applySubscriptionPlanChange({
        oldPlanId: 'creator',
        newPlanId: 'pro',
        oldMonthlyCents: 1900,
        newMonthlyCents: 3900,
      });

      expect(mockedUpsert).toHaveBeenCalledTimes(1);
      const args = mockedUpsert.mock.calls[0][0];
      const deltaCents = 3900 - 1900;
      // Active count is intentionally unchanged on a plan switch.
      expect(args.update.activeSubscriptions).toBeUndefined();
      expect(args.update.mrrCents).toEqual({ increment: deltaCents });
      expect(args.update.arrCents).toEqual({ increment: deltaCents * 12 });
      expect(args.update.creatorCount).toEqual({ decrement: 1 });
      expect(args.update.proCount).toEqual({ increment: 1 });
    });

    it('is a no-op when neither plan nor amount actually changed', async () => {
      await applySubscriptionPlanChange({
        oldPlanId: 'creator',
        newPlanId: 'creator',
        oldMonthlyCents: 1900,
        newMonthlyCents: 1900,
      });
      expect(mockedUpsert).not.toHaveBeenCalled();
    });
  });
});
