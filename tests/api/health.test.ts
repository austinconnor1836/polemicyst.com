import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  ping: vi.fn(),
  s3Send: vi.fn(),
}));

vi.mock('@shared/lib/prisma', () => ({
  prisma: { $queryRaw: mocks.queryRaw },
}));

vi.mock('@shared/queues', () => ({
  getRedisConnection: () => ({ ping: mocks.ping }),
}));

// Mock the @aws-sdk/client-s3 module so the health-check S3Client doesn't try
// to hit the real network. HeadBucketCommand is just a passthrough constructor.
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send(cmd: unknown) {
      return mocks.s3Send(cmd);
    }
  },
  HeadBucketCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock('@shared/lib/storage/storage-provider', () => ({
  S3_BUCKET: 'test-bucket',
  S3_REGION: 'us-east-1',
  S3_PREFIX: '',
}));

import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  beforeEach(() => {
    mocks.queryRaw.mockReset();
    mocks.ping.mockReset();
    mocks.s3Send.mockReset();
  });

  it('returns 200 + ok when all checks succeed', async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    mocks.ping.mockResolvedValueOnce('PONG');
    mocks.s3Send.mockResolvedValueOnce({});

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
    expect(body.redis).toBe('ok');
    expect(body.s3).toBe('ok');
  });

  it('returns 503 when one check throws — the failing field carries the error', async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    mocks.ping.mockResolvedValueOnce('PONG');
    mocks.s3Send.mockRejectedValueOnce(new Error('S3 head bucket failed'));

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.s3).toContain('S3 head bucket failed');
    // The other two stayed ok.
    expect(body.db).toBe('ok');
    expect(body.redis).toBe('ok');
  });

  it('returns 503 when a check times out (>2.5s)', async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    // Never resolves — the route's withTimeout() must kick in.
    mocks.ping.mockReturnValueOnce(new Promise(() => {}));
    mocks.s3Send.mockResolvedValueOnce({});

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.redis).toContain('timed out');
  }, 6000);
});
