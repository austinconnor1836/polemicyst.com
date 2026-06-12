/**
 * Vitest global setup.
 *
 * Keep this lean: only env defaults that every test needs. Per-suite mocks
 * live in tests/_mocks/* and are imported explicitly.
 */

// Prevent any test from accidentally reaching a real Prisma client. Each test
// suite that touches Prisma should call `vi.mock('@shared/lib/prisma', ...)`
// explicitly via tests/_mocks/prisma.ts.
// Vitest sets NODE_ENV=test automatically, so only fill in the secrets-y
// fallbacks that downstream modules read at import time.
process.env.NEXTAUTH_SECRET =
  process.env.NEXTAUTH_SECRET || 'test-nextauth-secret-do-not-use-in-prod';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
