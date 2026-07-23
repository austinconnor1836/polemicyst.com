/**
 * Seed a stable E2E test user.
 *
 * Idempotent: if the user already exists, we just ensure the pro subscription
 * plan is in place so quota gating doesn't get in the way of Playwright tests.
 *
 * Usage:
 *   npx tsx scripts/seed-test-user.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: false });

import { prisma } from '../shared/lib/prisma';

export const E2E_TEST_USER_EMAIL = 'e2e-test@polemicyst.local';
export const E2E_TEST_USER_NAME = 'E2E Test User';

export async function seedTestUser() {
  const existing = await prisma.user.findUnique({
    where: { email: E2E_TEST_USER_EMAIL },
  });

  if (existing) {
    if (existing.subscriptionPlan !== 'pro' || existing.acceptedAgeGate !== true) {
      const updated = await prisma.user.update({
        where: { id: existing.id },
        data: { subscriptionPlan: 'pro', acceptedAgeGate: true },
      });
      return updated;
    }
    return existing;
  }

  const created = await prisma.user.create({
    data: {
      email: E2E_TEST_USER_EMAIL,
      name: E2E_TEST_USER_NAME,
      subscriptionPlan: 'pro',
      acceptedAgeGate: true,
    },
  });
  return created;
}

async function main() {
  const user = await seedTestUser();
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        subscriptionPlan: user.subscriptionPlan,
      },
      null,
      2
    )
  );
  await prisma.$disconnect();
}

// Only auto-run when invoked directly (not when imported by a fixture).
if (require.main === module) {
  main().catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
}
