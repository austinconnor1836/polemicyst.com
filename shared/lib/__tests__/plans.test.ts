import { describe, it, expect } from 'vitest';
import { PLANS, resolvePlan, type PlanId } from '../plans';

describe('PLANS table', () => {
  it('contains all four tier ids', () => {
    const ids: PlanId[] = ['free', 'creator', 'pro', 'agency'];
    for (const id of ids) {
      expect(PLANS[id]).toBeDefined();
      expect(PLANS[id].id).toBe(id);
    }
  });

  describe('uploadMinutesPerMonth (primary value metric)', () => {
    it('free tier is 60 minutes', () => {
      expect(PLANS.free.limits.uploadMinutesPerMonth).toBe(60);
    });
    it('creator tier is 600 minutes', () => {
      expect(PLANS.creator.limits.uploadMinutesPerMonth).toBe(600);
    });
    it('pro tier is 1,800 minutes', () => {
      expect(PLANS.pro.limits.uploadMinutesPerMonth).toBe(1800);
    });
    it('agency tier is 6,000 minutes', () => {
      expect(PLANS.agency.limits.uploadMinutesPerMonth).toBe(6000);
    });
    it('limits monotonically increase from free → agency', () => {
      const tiers: PlanId[] = ['free', 'creator', 'pro', 'agency'];
      for (let i = 1; i < tiers.length; i++) {
        const prev = PLANS[tiers[i - 1]].limits.uploadMinutesPerMonth;
        const cur = PLANS[tiers[i]].limits.uploadMinutesPerMonth;
        expect(cur).toBeGreaterThan(prev);
      }
    });
  });

  describe('watermark flag', () => {
    it('is true only on free tier', () => {
      expect(PLANS.free.limits.watermark).toBe(true);
      expect(PLANS.creator.limits.watermark).toBe(false);
      expect(PLANS.pro.limits.watermark).toBe(false);
      expect(PLANS.agency.limits.watermark).toBe(false);
    });
  });

  describe('annual discount percent (derived from price displays)', () => {
    const parseDollars = (s: string) => Number(s.replace(/[$,]/g, ''));
    const discountPct = (id: PlanId) => {
      const m = parseDollars(PLANS[id].monthlyPriceDisplay);
      const a = parseDollars(PLANS[id].annualPriceDisplay);
      if (m === 0) return 0;
      return Math.round(((m - a) / m) * 100);
    };
    it('free tier has 0% (both prices $0)', () => {
      expect(discountPct('free')).toBe(0);
    });
    it('paid tiers offer a positive annual discount', () => {
      expect(discountPct('creator')).toBeGreaterThan(0);
      expect(discountPct('pro')).toBeGreaterThan(0);
      expect(discountPct('agency')).toBeGreaterThan(0);
    });
    it('annual price is never above monthly', () => {
      const tiers: PlanId[] = ['free', 'creator', 'pro', 'agency'];
      for (const id of tiers) {
        const m = parseDollars(PLANS[id].monthlyPriceDisplay);
        const a = parseDollars(PLANS[id].annualPriceDisplay);
        expect(a).toBeLessThanOrEqual(m);
      }
    });
  });

  describe('teamSeats', () => {
    it('is 1 for solo tiers (free/creator/pro)', () => {
      expect(PLANS.free.limits.teamSeats).toBe(1);
      expect(PLANS.creator.limits.teamSeats).toBe(1);
      expect(PLANS.pro.limits.teamSeats).toBe(1);
    });
    it('is > 1 for agency tier', () => {
      expect(PLANS.agency.limits.teamSeats).toBeGreaterThan(1);
    });
  });
});

describe('resolvePlan()', () => {
  it('returns free for null', () => {
    expect(resolvePlan(null).id).toBe('free');
  });
  it('returns free for undefined', () => {
    expect(resolvePlan(undefined).id).toBe('free');
  });
  it('returns free for empty string', () => {
    expect(resolvePlan('').id).toBe('free');
  });
  it('returns free for an unknown tier (no throw)', () => {
    expect(resolvePlan('enterprise-platinum').id).toBe('free');
    expect(resolvePlan('garbage').id).toBe('free');
  });

  it('returns the matching tier for each valid id', () => {
    const ids: PlanId[] = ['free', 'creator', 'pro', 'agency'];
    for (const id of ids) {
      expect(resolvePlan(id).id).toBe(id);
    }
  });

  it('maps the legacy "business" tier to "agency"', () => {
    expect(resolvePlan('business').id).toBe('agency');
  });
});
