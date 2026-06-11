import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { getStripeClient, getStripePriceId } from '@/lib/stripe';
import type { PlanId } from '@/lib/plans';

const PAID_PLANS: PlanId[] = ['creator', 'pro', 'agency'];

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { planId?: string; interval?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const planId = body.planId as PlanId;
  if (!PAID_PLANS.includes(planId)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }

  const rawInterval = typeof body.interval === 'string' ? body.interval.toLowerCase() : 'monthly';
  const interval: 'monthly' | 'annual' = rawInterval === 'annual' ? 'annual' : 'monthly';

  const priceId = getStripePriceId(planId, interval);
  if (!priceId) {
    return NextResponse.json(
      { error: `Stripe price not configured for ${planId} plan (${interval})` },
      { status: 500 }
    );
  }

  const stripe = getStripeClient();

  // Create or reuse Stripe customer
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      name: user.name ?? undefined,
      metadata: { userId: user.id },
    });
    customerId = customer.id;
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const origin = req.headers.get('origin') || '';
  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/pricing`,
  });

  return NextResponse.json({ url: checkoutSession.url });
}
