import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../auth';
import { prisma } from '@shared/lib/prisma';
import { getStripeClient, getStripePriceId } from '@/lib/stripe';
import type { PlanId } from '@/lib/plans';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  let body: { planId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const planId = body.planId as PlanId;
  if (planId !== 'pro' && planId !== 'business') {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }

  const priceId = getStripePriceId(planId);
  if (!priceId) {
    return NextResponse.json(
      { error: `Stripe price not configured for ${planId} plan` },
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
