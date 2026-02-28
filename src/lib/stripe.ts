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
  const pro = process.env.STRIPE_PRO_PRICE_ID;
  const business = process.env.STRIPE_BUSINESS_PRICE_ID;
  if (pro) PRICE_ID_MAP[pro] = 'pro';
  if (business) PRICE_ID_MAP[business] = 'business';
}

export function getStripePriceId(planId: PlanId): string | null {
  if (planId === 'pro') return process.env.STRIPE_PRO_PRICE_ID ?? null;
  if (planId === 'business') return process.env.STRIPE_BUSINESS_PRICE_ID ?? null;
  return null;
}

export function planIdFromPriceId(priceId: string): PlanId {
  buildPriceMap();
  return PRICE_ID_MAP[priceId] ?? 'free';
}
