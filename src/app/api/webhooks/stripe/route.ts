import { NextRequest } from 'next/server';
import { buffer } from 'micro';
import Stripe from 'stripe';
import { prisma } from '../../../../../shared/lib/prisma';

export const config = {
  api: {
    bodyParser: false,
  },
};

let stripeClient: Stripe | null = null;

function getStripeClient() {
  if (stripeClient) return stripeClient;
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    throw new Error('STRIPE_SECRET_KEY is required');
  }
  stripeClient = new Stripe(apiKey, {
    apiVersion: '2025-04-30.basil',
  });
  return stripeClient;
}

export async function POST(req: NextRequest) {
  const stripe = getStripeClient();
  const rawBody = await req.text();
  const signature = req.headers.get('stripe-signature') || '';
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return new Response('Missing STRIPE_WEBHOOK_SECRET', { status: 500 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err: any) {
    console.error('❌ Stripe webhook signature verification failed.', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  const subscription = event.data.object;

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const customerId = subscription.customer as string;
      const plan = subscription.items.data[0].price.nickname || 'free';

      await prisma.user.updateMany({
        where: { stripeCustomerId: customerId },
        data: { subscriptionPlan: plan },
      });
      break;
    }

    case 'customer.subscription.deleted': {
      const customerId = subscription.customer as string;

      await prisma.user.updateMany({
        where: { stripeCustomerId: customerId },
        data: { subscriptionPlan: 'free' },
      });
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
}
