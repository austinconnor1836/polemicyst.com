import Stripe from 'stripe';
import type { PlanId } from './plans';

let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (stripeClient) return stripeClient;
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    throw new Error('STRIPE_SECRET_KEY is required');
  }
  stripeClient = new Stripe(apiKey, {
    apiVersion: '2025-08-27.basil',
  });
  return stripeClient;
}

// ---------------------------------------------------------------------------
// Price-ID lookup — supports per-plan, per-interval env vars plus legacy vars
// ---------------------------------------------------------------------------

/**
 * Returns the Stripe price ID for a given plan and billing interval.
 *
 * Resolution order (first non-empty value wins):
 *   1. Per-plan / per-interval env var  (e.g. STRIPE_CREATOR_MONTHLY_PRICE_ID)
 *   2. Legacy env vars for back-compat  (STRIPE_PRO_PRICE_ID, STRIPE_BUSINESS_PRICE_ID)
 */
export function getStripePriceId(
  planId: PlanId,
  interval: 'monthly' | 'annual' = 'monthly'
): string | null {
  const key = interval === 'annual' ? 'ANNUAL' : 'MONTHLY';

  switch (planId) {
    case 'creator':
      return process.env[`STRIPE_CREATOR_${key}_PRICE_ID`] ?? null;
    case 'pro': {
      const specific = process.env[`STRIPE_PRO_${key}_PRICE_ID`] ?? null;
      if (specific) return specific;
      // Fall back to legacy STRIPE_PRO_PRICE_ID for monthly only
      if (interval === 'monthly') return process.env.STRIPE_PRO_PRICE_ID ?? null;
      return null;
    }
    case 'agency': {
      const specific = process.env[`STRIPE_AGENCY_${key}_PRICE_ID`] ?? null;
      if (specific) return specific;
      // Fall back to legacy STRIPE_BUSINESS_PRICE_ID for monthly only
      if (interval === 'monthly') return process.env.STRIPE_BUSINESS_PRICE_ID ?? null;
      return null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Reverse lookup — price ID → PlanId (used by webhooks)
// ---------------------------------------------------------------------------

/** Populated lazily from env vars so tests / cold-starts stay cheap. */
const PRICE_ID_MAP: Record<string, PlanId> = {};
let priceMapBuilt = false;

function buildPriceMap() {
  if (priceMapBuilt) return;
  priceMapBuilt = true;

  const entries: Array<[string | undefined, PlanId]> = [
    // New per-plan / per-interval vars
    [process.env.STRIPE_CREATOR_MONTHLY_PRICE_ID, 'creator'],
    [process.env.STRIPE_CREATOR_ANNUAL_PRICE_ID, 'creator'],
    [process.env.STRIPE_PRO_MONTHLY_PRICE_ID, 'pro'],
    [process.env.STRIPE_PRO_ANNUAL_PRICE_ID, 'pro'],
    [process.env.STRIPE_AGENCY_MONTHLY_PRICE_ID, 'agency'],
    [process.env.STRIPE_AGENCY_ANNUAL_PRICE_ID, 'agency'],
    // Legacy vars (back-compat — business maps to agency)
    [process.env.STRIPE_PRO_PRICE_ID, 'pro'],
    [process.env.STRIPE_BUSINESS_PRICE_ID, 'agency'],
  ];

  for (const [priceId, planId] of entries) {
    if (priceId) PRICE_ID_MAP[priceId] = planId;
  }
}

export function planIdFromPriceId(priceId: string): PlanId {
  buildPriceMap();
  return PRICE_ID_MAP[priceId] ?? 'free';
}
