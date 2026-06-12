import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLimiter } from '@/lib/rate-limit';

describe('rate-limit — in-memory fallback', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Force the memory path by unsetting Upstash env vars.
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses the memory mode when Upstash env vars are unset', () => {
    const limiter = createLimiter({ tokens: 5, window: '60 s', prefix: 'test:mode' });
    expect(limiter.mode).toBe('memory');
  });

  it('enforces the configured rate (10 in 60s → 11th request is denied)', async () => {
    const limiter = createLimiter({ tokens: 10, window: '60 s', prefix: 'test:rate' });
    const key = 'user-A';

    for (let i = 0; i < 10; i++) {
      const r = await limiter.check(key);
      expect(r.success).toBe(true);
    }

    const blocked = await limiter.check(key);
    expect(blocked.success).toBe(false);
    expect(blocked.limit).toBe(10);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it('different keys do not share buckets', async () => {
    const limiter = createLimiter({ tokens: 1, window: '60 s', prefix: 'test:scope' });
    const a = await limiter.check('user-A');
    const b = await limiter.check('user-B');
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
  });

  it('does not import @upstash/* when env is unset (no network call setup)', async () => {
    // If Upstash were activated, createLimiter().mode would flip to 'upstash'.
    // Just calling check() exercises the code path.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const limiter = createLimiter({ tokens: 3, window: '60 s', prefix: 'test:nofetch' });
    await limiter.check('user-X');
    await limiter.check('user-X');
    await limiter.check('user-X');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(limiter.mode).toBe('memory');
    fetchSpy.mockRestore();
  });
});
