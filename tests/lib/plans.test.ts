import { describe, it, expect } from 'vitest';
import { PLANS, resolvePlan, type PlanId } from '@shared/lib/plans';

/**
 * High-value tests for the pricing module — the plan structure backs the
 * subscription / billing flows and powers MRR rollups, so the shape and the
 * annual-discount invariant should not drift unnoticed.
 */
describe('plans', () => {
  const ALL_IDS: PlanId[] = ['free', 'creator', 'pro', 'agency'];

  it.each(ALL_IDS)('plan %s resolves with non-null uploadMinutesPerMonth', (id) => {
    const plan = resolvePlan(id);
    expect(plan.id).toBe(id);
    expect(plan.limits.uploadMinutesPerMonth).not.toBeNull();
    expect(plan.limits.uploadMinutesPerMonth).not.toBeUndefined();
    expect(typeof plan.limits.uploadMinutesPerMonth).toBe('number');
    expect(plan.limits.uploadMinutesPerMonth).toBeGreaterThanOrEqual(0);
  });

  it('annual price is strictly less than 12x monthly (or both zero on the free tier)', () => {
    const parseDollars = (s: string) => Number(s.replace(/[^0-9.]/g, ''));
    for (const id of ALL_IDS) {
      const plan = PLANS[id];
      const monthly = parseDollars(plan.monthlyPriceDisplay);
      const annualPerMonth = parseDollars(plan.annualPriceDisplay);
      if (monthly === 0) {
        // Free tier — annual must also be 0; no discount to validate.
        expect(annualPerMonth).toBe(0);
        continue;
      }
      // The "annual" price is displayed as the per-month equivalent when paid
      // annually, so a discount means annualPerMonth < monthly. A 12x annual
      // total must therefore be strictly less than 12 * monthly.
      expect(annualPerMonth * 12).toBeLessThan(monthly * 12);
    }
  });

  it('free plan watermarks rendered clips; paid plans do not', () => {
    expect(resolvePlan('free').limits.watermark).toBe(true);
    expect(resolvePlan('creator').limits.watermark).toBe(false);
    expect(resolvePlan('pro').limits.watermark).toBe(false);
    expect(resolvePlan('agency').limits.watermark).toBe(false);
  });

  it('resolvePlan() maps legacy "business" to the agency tier', () => {
    expect(resolvePlan('business').id).toBe('agency');
  });

  it('resolvePlan() defaults unknown / null inputs to free', () => {
    expect(resolvePlan(null).id).toBe('free');
    expect(resolvePlan(undefined).id).toBe('free');
    expect(resolvePlan('garbage-tier').id).toBe('free');
  });
});
