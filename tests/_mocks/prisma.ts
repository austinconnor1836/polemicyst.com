/**
 * Reusable Prisma mock for tests. Each test suite that touches Prisma should
 * `vi.mock('@shared/lib/prisma', () => ({ prisma: createPrismaMock() }))`.
 *
 * The shape is intentionally permissive — every model exposes the methods we
 * actually call from the code under test. Add more as needed.
 */
import { vi } from 'vitest';

export interface PrismaMock {
  $queryRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  costEvent: {
    createMany: ReturnType<typeof vi.fn>;
    aggregate: ReturnType<typeof vi.fn>;
  };
  subscriptionMetric: {
    upsert: ReturnType<typeof vi.fn>;
  };
  usageMonth: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  videoFeed: {
    count: ReturnType<typeof vi.fn>;
  };
  video: {
    count: ReturnType<typeof vi.fn>;
  };
}

export function createPrismaMock(): PrismaMock {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    // Default $transaction implementation: invoke the callback with the same mock
    // so call-sites that pass `async (tx) => tx.foo.bar(...)` exercise the mock.
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      if (typeof fn === 'function') {
        return fn(prismaProxy);
      }
      return fn;
    }),
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    costEvent: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      aggregate: vi.fn().mockResolvedValue({ _sum: { estimatedCostUsd: 0 }, _count: 0 }),
    },
    subscriptionMetric: {
      upsert: vi.fn().mockResolvedValue(undefined),
    },
    usageMonth: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    videoFeed: {
      count: vi.fn().mockResolvedValue(0),
    },
    video: {
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

// Self-referencing proxy so $transaction(fn) can hand back the same mock object.
let prismaProxy: PrismaMock = createPrismaMock();

export function setPrismaProxy(m: PrismaMock) {
  prismaProxy = m;
}
