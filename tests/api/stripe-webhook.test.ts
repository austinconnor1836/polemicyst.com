import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  subscriptionsRetrieve: vi.fn(),
  userUpdateMany: vi.fn().mockResolvedValue({ count: 1 }),
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  planIdFromPriceId: vi.fn(),
  posthogCapture: vi.fn(),
  flushServerPostHog: vi.fn().mockResolvedValue(undefined),
  applySubscriptionStart: vi.fn().mockResolvedValue(undefined),
  applySubscriptionEnd: vi.fn().mockResolvedValue(undefined),
  applySubscriptionPlanChange: vi.fn().mockResolvedValue(undefined),
  monthlyCentsForPlan: vi.fn(() => 1900),
  monthlyEquivalentCents: vi.fn(() => 1900),
}));

vi.mock('@/lib/stripe', () => ({
  getStripeClient: () => ({
    webhooks: { constructEvent: mocks.constructEvent },
    subscriptions: { retrieve: mocks.subscriptionsRetrieve },
  }),
  planIdFromPriceId: mocks.planIdFromPriceId,
}));

// The route imports prisma via a relative path
// `../../../../../shared/lib/prisma`. Mock by alias AND by the relative
// specifier — Vitest matches the specifier the importer used.
vi.mock('@shared/lib/prisma', () => ({
  prisma: {
    user: {
      updateMany: mocks.userUpdateMany,
      findUnique: mocks.userFindUnique,
      findFirst: mocks.userFindFirst,
    },
  },
}));
vi.mock('../../../../../shared/lib/prisma', () => ({
  prisma: {
    user: {
      updateMany: mocks.userUpdateMany,
      findUnique: mocks.userFindUnique,
      findFirst: mocks.userFindFirst,
    },
  },
}));

vi.mock('@/lib/posthog', () => ({
  getServerPostHog: () => ({ capture: mocks.posthogCapture }),
  flushServerPostHog: mocks.flushServerPostHog,
}));

vi.mock('@shared/lib/subscription-metrics', () => ({
  applySubscriptionStart: mocks.applySubscriptionStart,
  applySubscriptionEnd: mocks.applySubscriptionEnd,
  applySubscriptionPlanChange: mocks.applySubscriptionPlanChange,
  monthlyCentsForPlan: mocks.monthlyCentsForPlan,
  monthlyEquivalentCents: mocks.monthlyEquivalentCents,
}));

import { POST } from '@/app/api/webhooks/stripe/route';

function makeReq(body: string, signature = 'sig-test') {
  return {
    text: async () => body,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'stripe-signature' ? signature : null),
    },
  } as unknown as import('next/server').NextRequest;
}

describe('POST /api/webhooks/stripe', () => {
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_value';
    Object.values(mocks).forEach((m) => {
      if (typeof (m as { mockReset?: () => void }).mockReset === 'function') {
        (m as { mockReset: () => void }).mockReset();
      }
    });
    // Re-arm default impls that mockReset wiped.
    mocks.userUpdateMany.mockResolvedValue({ count: 1 });
    mocks.flushServerPostHog.mockResolvedValue(undefined);
    mocks.applySubscriptionStart.mockResolvedValue(undefined);
    mocks.applySubscriptionEnd.mockResolvedValue(undefined);
    mocks.applySubscriptionPlanChange.mockResolvedValue(undefined);
    mocks.monthlyCentsForPlan.mockReturnValue(1900);
    mocks.monthlyEquivalentCents.mockReturnValue(1900);
  });

  it('returns 400 when the signature is invalid', async () => {
    mocks.constructEvent.mockImplementationOnce(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });

    const res = await POST(makeReq('{}', 'bad-sig'));
    expect(res.status).toBe(400);
  });

  it('checkout.session.completed → captures paid_conversion AND rolls up MRR', async () => {
    mocks.constructEvent.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_test',
          customer_details: { email: 'buyer@example.com' },
          subscription: 'sub_test',
          amount_total: 1900,
        },
      },
    });
    mocks.subscriptionsRetrieve.mockResolvedValueOnce({
      items: {
        data: [
          {
            price: {
              id: 'price_creator_monthly',
              unit_amount: 1900,
              recurring: { interval: 'month' },
            },
          },
        ],
      },
    });
    mocks.planIdFromPriceId.mockReturnValueOnce('creator');
    mocks.userFindUnique.mockResolvedValueOnce({ id: 'u-1' });

    const res = await POST(makeReq('{}'));
    expect(res.status).toBe(200);

    // PostHog event for the funnel.
    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: 'u-1',
        event: 'paid_conversion',
        properties: expect.objectContaining({
          plan: 'creator',
          interval: 'monthly',
          amount: 1900,
        }),
      })
    );
    // SubscriptionMetric rollup write for MRR/ARR.
    expect(mocks.applySubscriptionStart).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: 'creator',
        countAsNew: true,
      })
    );
  });

  it('customer.subscription.deleted → captures subscription_canceled AND rolls up churn', async () => {
    mocks.constructEvent.mockReturnValueOnce({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          customer: 'cus_test',
          items: {
            data: [
              {
                price: {
                  id: 'price_pro_monthly',
                  unit_amount: 3900,
                  recurring: { interval: 'month' },
                },
              },
            ],
          },
          cancellation_details: { reason: 'cancellation_requested' },
        },
      },
    });
    mocks.planIdFromPriceId.mockReturnValueOnce('pro');
    mocks.userFindFirst.mockResolvedValueOnce({ id: 'u-2' });

    const res = await POST(makeReq('{}'));
    expect(res.status).toBe(200);

    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: 'u-2',
        event: 'subscription_canceled',
        properties: expect.objectContaining({ plan: 'pro' }),
      })
    );
    expect(mocks.applySubscriptionEnd).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 'pro' })
    );
    // The user is downgraded to free in the DB.
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: { stripeCustomerId: 'cus_test' },
      data: { subscriptionPlan: 'free' },
    });
  });
});
