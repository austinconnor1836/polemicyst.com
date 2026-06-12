import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so the mock fns exist BEFORE vi.mock factories run.
const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  getSessionFromBearer: vi.fn(),
  getServerSession: vi.fn(),
}));

vi.mock('@shared/lib/prisma', () => ({
  prisma: { user: { findUnique: mocks.userFindUnique } },
}));

vi.mock('@shared/lib/auth', () => ({
  getSessionFromBearer: mocks.getSessionFromBearer,
}));

vi.mock('next-auth/next', () => ({
  getServerSession: mocks.getServerSession,
}));

// auth-helpers.ts does `await import('../../auth')` (i.e. the root auth.ts).
// Stub it so we don't pull in NextAuth + Prisma at evaluation time.
vi.mock('../../auth', () => ({
  authOptions: { providers: [] },
}));

import { getAuthenticatedUser } from '@shared/lib/auth-helpers';

function makeReq(headers: Record<string, string> = {}, pathname = '/api/test') {
  return {
    headers: {
      get(name: string): string | null {
        const k = name.toLowerCase();
        for (const [hk, hv] of Object.entries(headers)) {
          if (hk.toLowerCase() === k) return hv;
        }
        return null;
      },
    },
    nextUrl: { pathname },
  } as unknown as import('next/server').NextRequest;
}

describe('getAuthenticatedUser', () => {
  beforeEach(() => {
    mocks.userFindUnique.mockReset();
    mocks.getSessionFromBearer.mockReset();
    mocks.getServerSession.mockReset();
  });

  it('returns the user when a valid web session is present', async () => {
    mocks.getServerSession.mockResolvedValueOnce({
      user: { email: 'a@b.com', id: 'u-1' },
    });
    mocks.userFindUnique.mockResolvedValueOnce({ id: 'u-1', email: 'a@b.com' });

    const user = await getAuthenticatedUser(makeReq());

    expect(user).toEqual({ id: 'u-1', email: 'a@b.com' });
    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      where: { email: 'a@b.com' },
    });
    expect(mocks.getSessionFromBearer).not.toHaveBeenCalled();
  });

  it('falls back to Bearer JWT when no cookie session exists', async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    mocks.getSessionFromBearer.mockResolvedValueOnce({
      id: 'u-2',
      email: 'm@b.com',
    });
    mocks.userFindUnique.mockResolvedValueOnce({ id: 'u-2', email: 'm@b.com' });

    const user = await getAuthenticatedUser(makeReq({ authorization: 'Bearer some-jwt-token' }));

    expect(user).toEqual({ id: 'u-2', email: 'm@b.com' });
    expect(mocks.getSessionFromBearer).toHaveBeenCalledTimes(1);
  });

  it('returns null when neither a session nor a Bearer token is present', async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    mocks.getSessionFromBearer.mockResolvedValueOnce(null);

    const user = await getAuthenticatedUser(makeReq());
    expect(user).toBeNull();
  });

  it('returns null when the Bearer JWT is present but invalid', async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    mocks.getSessionFromBearer.mockResolvedValueOnce(null);

    const user = await getAuthenticatedUser(makeReq({ authorization: 'Bearer invalid-jwt' }));
    expect(user).toBeNull();
  });
});
