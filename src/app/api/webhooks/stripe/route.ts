import { NextRequest } from 'next/server';
import { prisma } from '../../../../../shared/lib/prisma';
import { getStripeClient, planIdFromPriceId } from '@/lib/stripe';

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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Stripe webhook signature verification failed.', message);
    return new Response(`Webhook Error: ${message}`, { status: 400 });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerId = session.customer as string;
      const userEmail = session.customer_details?.email;

      // Safety net: link customer and set plan from the checkout session
      if (userEmail && customerId) {
        const subscriptionId = session.subscription as string | null;
        let planId = 'free';

        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          const priceId = sub.items.data[0]?.price?.id;
          if (priceId) {
            planId = planIdFromPriceId(priceId);
          }
        }

        await prisma.user.updateMany({
          where: { email: userEmail },
          data: { stripeCustomerId: customerId, subscriptionPlan: planId },
        });
      }
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const customerId = subscription.customer as string;
      const priceId = subscription.items.data[0]?.price?.id;
      const planId = priceId ? planIdFromPriceId(priceId) : 'free';

      await prisma.user.updateMany({
        where: { stripeCustomerId: customerId },
        data: { subscriptionPlan: planId },
      });
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
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
