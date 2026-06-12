import { NextRequest } from 'next/server';
import { prisma } from '../../../../../shared/lib/prisma';
import { getStripeClient, planIdFromPriceId } from '@/lib/stripe';
import { flushServerPostHog, getServerPostHog } from '@/lib/posthog';
import {
  applySubscriptionEnd,
  applySubscriptionPlanChange,
  applySubscriptionStart,
  monthlyCentsForPlan,
  monthlyEquivalentCents,
} from '@shared/lib/subscription-metrics';

function normalizeInterval(interval?: string | null): 'monthly' | 'annual' | 'unknown' {
  if (interval === 'month') return 'monthly';
  if (interval === 'year') return 'annual';
  return 'unknown';
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
      let planId = 'free';
      let interval: 'monthly' | 'annual' | 'unknown' = 'unknown';
      let amount = session.amount_total ?? 0;
      if (userEmail && customerId) {
        const subscriptionId = session.subscription as string | null;

        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          const priceItem = sub.items.data[0]?.price;
          const priceId = priceItem?.id;
          if (priceId) {
            planId = planIdFromPriceId(priceId);
          }
          interval = normalizeInterval(priceItem?.recurring?.interval ?? null);
          if (!amount && priceItem?.unit_amount) {
            amount = priceItem.unit_amount;
          }
        }

        await prisma.user.updateMany({
          where: { email: userEmail },
          data: { stripeCustomerId: customerId, subscriptionPlan: planId },
        });
      }

      // W013: paid_conversion. Use the Clipfire user.id as distinctId so it
      // ties back to the same identity the client-side identify() set.
      const posthog = getServerPostHog();
      if (posthog && userEmail) {
        try {
          const user = await prisma.user.findUnique({
            where: { email: userEmail },
            select: { id: true },
          });
          if (user) {
            posthog.capture({
              distinctId: user.id,
              event: 'paid_conversion',
              properties: {
                plan: planId,
                interval,
                amount,
              },
            });
            await flushServerPostHog();
          }
        } catch {
          // Non-fatal.
        }
      }

      // W017: subscription start rollup. We treat checkout.session.completed as
      // the canonical "new paid subscription" signal — customer.subscription.created
      // fires too but doesn't carry the checkout-amount in the same payload.
      if (planId !== 'free') {
        const monthlyCents = monthlyEquivalentCents(amount, interval);
        await applySubscriptionStart({
          planId: planId as 'creator' | 'pro' | 'agency',
          // Fall back to the plan's display monthly price when Stripe didn't
          // surface a usable amount on the session.
          monthlyCents:
            monthlyCents > 0
              ? monthlyCents
              : monthlyCentsForPlan(planId as 'creator' | 'pro' | 'agency'),
          countAsNew: true,
        });
      }
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const customerId = subscription.customer as string;
      const subStatus = subscription.status;

      // If subscription is no longer active/trialing, downgrade to free
      if (subStatus !== 'active' && subStatus !== 'trialing') {
        await prisma.user.updateMany({
          where: { stripeCustomerId: customerId },
          data: { subscriptionPlan: 'free' },
        });
        console.log(`Downgraded customer ${customerId} to free (status: ${subStatus})`);
      } else {
        const priceItem = subscription.items.data[0]?.price;
        const priceId = priceItem?.id;
        const planId = priceId ? planIdFromPriceId(priceId) : 'free';

        await prisma.user.updateMany({
          where: { stripeCustomerId: customerId },
          data: { subscriptionPlan: planId },
        });

        // W017: subscription-metrics rollup.
        const interval = normalizeInterval(priceItem?.recurring?.interval ?? null);
        const newMonthlyCents = monthlyEquivalentCents(priceItem?.unit_amount ?? 0, interval);
        const safeNewMonthlyCents =
          newMonthlyCents > 0
            ? newMonthlyCents
            : planId !== 'free'
              ? monthlyCentsForPlan(planId as 'creator' | 'pro' | 'agency')
              : 0;

        if (event.type === 'customer.subscription.updated') {
          // Detect plan change via previous_attributes (set by Stripe when an
          // existing field changed). If items changed, the previous price ID
          // is reachable via previous_attributes.items.data[0].price.id.
          const previousAttributes = (event.data as { previous_attributes?: unknown })
            .previous_attributes;
          const prevItems = (
            previousAttributes as
              | {
                  items?: {
                    data?: Array<{
                      price?: {
                        id?: string;
                        unit_amount?: number;
                        recurring?: { interval?: string };
                      };
                    }>;
                  };
                }
              | undefined
          )?.items?.data;
          const prevPrice = prevItems && prevItems[0]?.price ? prevItems[0].price : undefined;
          if (prevPrice?.id) {
            const oldPlanId = planIdFromPriceId(prevPrice.id);
            const oldInterval = normalizeInterval(prevPrice.recurring?.interval ?? null);
            const oldMonthlyCents = monthlyEquivalentCents(prevPrice.unit_amount ?? 0, oldInterval);
            const safeOldMonthlyCents =
              oldMonthlyCents > 0
                ? oldMonthlyCents
                : oldPlanId !== 'free'
                  ? monthlyCentsForPlan(oldPlanId as 'creator' | 'pro' | 'agency')
                  : 0;
            if (oldPlanId !== 'free' && planId !== 'free') {
              await applySubscriptionPlanChange({
                oldPlanId: oldPlanId as 'creator' | 'pro' | 'agency',
                newPlanId: planId as 'creator' | 'pro' | 'agency',
                oldMonthlyCents: safeOldMonthlyCents,
                newMonthlyCents: safeNewMonthlyCents,
              });
            }
          }
        }
        // Note: customer.subscription.created is intentionally not double-counted
        // here — checkout.session.completed already rolled up the start.
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const customerId = subscription.customer as string;

      // Capture the plan + reason BEFORE we downgrade the row.
      const priceItem = subscription.items.data[0]?.price;
      const priceId = priceItem?.id;
      const previousPlan = priceId ? planIdFromPriceId(priceId) : 'free';
      const cancellationReason =
        (subscription as { cancellation_details?: { reason?: string | null } | null })
          .cancellation_details?.reason ?? null;

      const previousUser = await prisma.user.findFirst({
        where: { stripeCustomerId: customerId },
        select: { id: true },
      });

      await prisma.user.updateMany({
        where: { stripeCustomerId: customerId },
        data: { subscriptionPlan: 'free' },
      });

      const posthog = getServerPostHog();
      if (posthog && previousUser) {
        try {
          posthog.capture({
            distinctId: previousUser.id,
            event: 'subscription_canceled',
            properties: {
              plan: previousPlan,
              cancellation_reason: cancellationReason ?? undefined,
            },
          });
          await flushServerPostHog();
        } catch {
          // Non-fatal.
        }
      }

      // W017: subscription end rollup (churn).
      if (previousPlan !== 'free') {
        const interval = normalizeInterval(priceItem?.recurring?.interval ?? null);
        const monthlyCents = monthlyEquivalentCents(priceItem?.unit_amount ?? 0, interval);
        await applySubscriptionEnd({
          planId: previousPlan as 'creator' | 'pro' | 'agency',
          monthlyCents:
            monthlyCents > 0
              ? monthlyCents
              : monthlyCentsForPlan(previousPlan as 'creator' | 'pro' | 'agency'),
        });
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as { subscription?: string | null } & Record<string, any>;
      const subscriptionId = invoice.subscription ?? null;
      if (subscriptionId) {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const subStatus = sub.status;
        if (subStatus === 'past_due' || subStatus === 'unpaid' || subStatus === 'canceled') {
          const customerId = sub.customer as string;
          await prisma.user.updateMany({
            where: { stripeCustomerId: customerId },
            data: { subscriptionPlan: 'free' },
          });
          console.log(
            `Payment failed: downgraded customer ${customerId} to free (status: ${subStatus})`
          );
        }
      }
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
}
