/**
 * Mint a NextAuth-compatible JWT for the seeded E2E test user.
 *
 * Mirrors the mobile-JWT flow in `src/app/api/auth/mobile/google/route.ts`
 * (same secret, same claim shape) so Playwright can inject the token as either:
 *   1. The `next-auth.session-token` cookie (web session), OR
 *   2. `Authorization: Bearer <jwt>` (mobile-parity)
 *
 * Usage (prints JSON to stdout):
 *   npx tsx scripts/mint-test-jwt.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: false });

import { encode } from 'next-auth/jwt';
import { seedTestUser, E2E_TEST_USER_EMAIL } from './seed-test-user';
import { prisma } from '../shared/lib/prisma';

export async function mintTestJwt() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET must be set in .env or .env.local to mint an E2E JWT');
  }

  const user = await seedTestUser();

  const token = await encode({
    token: {
      sub: user.id,
      email: user.email,
      name: user.name,
      picture: user.image,
      id: user.id,
    },
    secret,
  });

  return {
    token,
    user: {
      id: user.id,
      email: user.email ?? E2E_TEST_USER_EMAIL,
      name: user.name ?? null,
    },
  };
}

async function main() {
  const result = await mintTestJwt();
  // Wrap in sentinel so callers that pipe through Prisma's `log: ['query']`
  // stdout noise can extract the JSON deterministically.
  process.stdout.write('__MINT_JWT_JSON__' + JSON.stringify(result) + '\n');
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
}
