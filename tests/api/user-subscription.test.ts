import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  userFindUnique: vi.fn(),
  videoCount: vi.fn().mockResolvedValue(0),
  usageMonthFindUnique: vi.fn().mockResolvedValue(null),
  costAggregate: vi.fn().mockResolvedValue({
    _sum: { estimatedCostUsd: 0 },
    _count: 0,
  }),
}));

vi.mock('@shared/lib/auth-helpers', () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));

vi.mock('@shared/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    video: { count: mocks.videoCount },
    usageMonth: { findUnique: mocks.usageMonthFindUnique },
    costEvent: { aggregate: mocks.costAggregate },
  },
}));

import { GET } from '@/app/api/user/subscription/route';

function makeReq() {
  // The route's getAuthenticatedUser is mocked so it doesn't actually read req.
  return {} as unknown as import('next/server').NextRequest;
}

describe('GET /api/user/subscription', () => {
  beforeEach(() => {
    mocks.getAuthenticatedUser.mockReset();
    mocks.userFindUnique.mockReset();
    mocks.videoCount.mockResolvedValue(0);
    mocks.usageMonthFindUnique.mockResolvedValue(null);
    mocks.costAggregate.mockResolvedValue({
      _sum: { estimatedCostUsd: 0 },
      _count: 0,
    });
  });

  it('returns 401 when the request is unauthenticated', async () => {
    mocks.getAuthenticatedUser.mockResolvedValueOnce(null);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('returns plan + usage shape for an authenticated user', async () => {
    mocks.getAuthenticatedUser.mockResolvedValueOnce({
      id: 'u-1',
      email: 'a@b.com',
    });
    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'u-1',
      subscriptionPlan: 'creator',
      stripeCustomerId: 'cus_test_123',
      _count: { videoFeeds: 2 },
    });
    mocks.usageMonthFindUnique.mockResolvedValueOnce({ processedMinutes: 42 });
    mocks.videoCount.mockResolvedValueOnce(5);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan.id).toBe('creator');
    expect(body.plan.name).toBeTruthy();
    expect(typeof body.plan.limits.uploadMinutesPerMonth).toBe('number');
    expect(body.usage.uploadMinutesUsed).toBe(42);
    expect(body.usage.uploadMinutesLimit).toBe(body.plan.limits.uploadMinutesPerMonth);
    expect(body.usage.clipsThisMonth).toBe(5);
    expect(body.hasStripeCustomer).toBe(true);
  });
});
