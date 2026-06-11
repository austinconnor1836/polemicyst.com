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

const PRICE_ID_MAP: Record<string, PlanId> = {};

function buildPriceMap() {
  if (Object.keys(PRICE_ID_MAP).length > 0) return;
  // New plan env vars (added in T010 pricing-backend).
  const creator = process.env.STRIPE_CREATOR_MONTHLY_PRICE_ID;
  const pro = process.env.STRIPE_PRO_MONTHLY_PRICE_ID ?? process.env.STRIPE_PRO_PRICE_ID;
  const agency = process.env.STRIPE_AGENCY_MONTHLY_PRICE_ID ?? process.env.STRIPE_BUSINESS_PRICE_ID;
  if (creator) PRICE_ID_MAP[creator] = 'creator';
  if (pro) PRICE_ID_MAP[pro] = 'pro';
  if (agency) PRICE_ID_MAP[agency] = 'agency';
}

/**
 * Resolve a Stripe price ID for a given plan.
 *
 * NOTE(T010-followup): This stub returns the monthly price only. Once the
 * pricing-backend branch (T010) lands with per-interval price IDs, replace
 * this with a lookup that accepts `interval: 'monthly' | 'annual'`.
 */
export function getStripePriceId(planId: PlanId): string | null {
  if (planId === 'creator') {
    return (
      process.env.STRIPE_CREATOR_MONTHLY_PRICE_ID ?? process.env.STRIPE_CREATOR_PRICE_ID ?? null
    );
  }
  if (planId === 'pro') {
    return (
      process.env.STRIPE_PRO_MONTHLY_PRICE_ID ??
      // Legacy env var kept for backward compat during the pricing transition.
      process.env.STRIPE_PRO_PRICE_ID ??
      null
    );
  }
  if (planId === 'agency') {
    return (
      process.env.STRIPE_AGENCY_MONTHLY_PRICE_ID ??
      // Legacy env var kept for backward compat during the pricing transition.
      process.env.STRIPE_BUSINESS_PRICE_ID ??
      null
    );
  }
  return null;
}

export function planIdFromPriceId(priceId: string): PlanId {
  buildPriceMap();
  return PRICE_ID_MAP[priceId] ?? 'free';
}
