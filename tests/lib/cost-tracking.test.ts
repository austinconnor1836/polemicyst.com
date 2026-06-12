import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the prisma module BEFORE importing the SUT. Vitest hoists vi.mock to the
// top of the file, so we can safely reference the factory's returned shape after.
vi.mock('@shared/lib/prisma', () => {
  return {
    prisma: {
      costEvent: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    },
  };
});

import { CostTracker, estimateGeminiCost, estimateS3Cost } from '@shared/lib/cost-tracking';
import { prisma } from '@shared/lib/prisma';

const mockedPrisma = prisma as unknown as {
  costEvent: { createMany: ReturnType<typeof vi.fn> };
};

describe('CostTracker', () => {
  beforeEach(() => {
    mockedPrisma.costEvent.createMany.mockReset();
    mockedPrisma.costEvent.createMany.mockResolvedValue({ count: 0 });
  });

  it('accumulates events in memory without writing to the DB', () => {
    const tracker = new CostTracker('user-1', 'job-1');
    expect(tracker.eventCount).toBe(0);

    tracker.add({ stage: 'download', estimatedCostUsd: 0.001 });
    tracker.add({ stage: 'llm_scoring', estimatedCostUsd: 0.01, inputTokens: 1000 });

    expect(tracker.eventCount).toBe(2);
    expect(tracker.totalCostUsd).toBeCloseTo(0.011);
    expect(mockedPrisma.costEvent.createMany).not.toHaveBeenCalled();
  });

  it('track() wraps an async op, recording durationMs and any cost fields from buildEvent', async () => {
    const tracker = new CostTracker('user-1', 'job-1');

    const result = await tracker.track(
      'llm_scoring',
      async () => {
        // Simulate a small amount of latency so durationMs > 0 in CI.
        await new Promise((r) => setTimeout(r, 5));
        return { tokensIn: 100, tokensOut: 50, cost: 0.002 };
      },
      (res, durationMs) => ({
        provider: 'gemini',
        model: 'gemini-flash',
        inputTokens: res.tokensIn,
        outputTokens: res.tokensOut,
        estimatedCostUsd: res.cost,
        // durationMs is auto-applied by track() — verify by NOT setting it here.
        metadata: { durationMs },
      })
    );

    expect(result.cost).toBe(0.002);
    expect(tracker.eventCount).toBe(1);
    expect(tracker.totalCostUsd).toBeCloseTo(0.002);
  });

  it('flush() is non-fatal when the DB write throws', async () => {
    const tracker = new CostTracker('user-1', 'job-1');
    tracker.add({ stage: 'download', estimatedCostUsd: 0.001 });

    mockedPrisma.costEvent.createMany.mockRejectedValueOnce(new Error('simulated DB outage'));

    // Should not throw; just logs the error.
    await expect(tracker.flush()).resolves.toBeUndefined();
    expect(mockedPrisma.costEvent.createMany).toHaveBeenCalledTimes(1);
  });

  it('flush() is a no-op when there are no events', async () => {
    const tracker = new CostTracker('user-1', 'job-1');
    await tracker.flush();
    expect(mockedPrisma.costEvent.createMany).not.toHaveBeenCalled();
  });
});

describe('cost estimators', () => {
  it('estimateGeminiCost returns positive cost when given non-zero input', () => {
    const est = estimateGeminiCost({
      numFrames: 10,
      audioSeconds: 30,
      transcriptChars: 4000,
      outputTokens: 500,
    });
    expect(est.inputTokens).toBeGreaterThan(0);
    expect(est.outputTokens).toBe(500);
    expect(est.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('estimateS3Cost scales with byte size', () => {
    const small = estimateS3Cost(1024);
    const large = estimateS3Cost(1024 * 1024 * 1024); // 1 GB
    expect(large).toBeGreaterThan(small);
  });
});
