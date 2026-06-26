/**
 * Runway Demo Seed Script
 *
 * Seeds 6 months of fake `RunwayBalance` history so the /admin/runway dashboard
 * shows a real curve for investor demos.
 *
 * Usage:
 *   npx tsx scripts/seed-runway-demo.ts
 *   npx tsx scripts/seed-runway-demo.ts --clear   # wipe existing rows first
 *   npx tsx scripts/seed-runway-demo.ts --months 12
 *
 * Tweak the curve shape in `buildSeries()` below.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: false });

import { prisma } from '../shared/lib/prisma';

const DEMO_USER_ID = 'cldemo-runway-seed-000000000';

function parseArgs(): { clear: boolean; months: number } {
  const argv = process.argv.slice(2);
  let clear = false;
  let months = 6;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--clear') clear = true;
    if (argv[i] === '--months') months = Math.max(1, Number(argv[++i] || 6));
  }
  return { clear, months };
}

/**
 * Build a demo balance curve.
 *
 * Shape: started with a seed-round $250k, spent ~$15k/mo for the first few
 * months, revenue started ramping in month -2, current month shows $172k
 * balance + $4.2k/mo revenue (= still burning, but with traction).
 *
 * Returns one snapshot per month going BACKWARDS from today.
 */
function buildSeries(months: number) {
  const out: Array<{
    asOfDate: Date;
    bankBalanceCents: number;
    revenueLast30dCents: number;
    notes: string;
  }> = [];

  const today = new Date();
  const startBalance = 250_000_00; // cents — $250k
  const baseBurn = 13_000_00; // ~$13k/mo
  const burnJitter = 2_000_00;

  for (let monthsAgo = months - 1; monthsAgo >= 0; monthsAgo--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - monthsAgo, 1));

    const elapsed = months - 1 - monthsAgo; // 0 oldest → months-1 newest
    const monthsRemaining = monthsAgo;

    // Revenue ramps non-linearly: $0 first 4 months, then $500 → $1500 → $4200
    let revenueCents = 0;
    if (elapsed === months - 3) revenueCents = 500_00;
    if (elapsed === months - 2) revenueCents = 1_500_00;
    if (elapsed === months - 1) revenueCents = 4_200_00;

    // Burn — slight uptick over time as infra grows
    const burnVariance = Math.round((Math.sin(elapsed * 1.3) + 1) * 0.5 * burnJitter);
    const burnThisMonth = baseBurn + burnVariance + elapsed * 200_00;
    const netBurn = burnThisMonth - revenueCents;

    // Walk balance forward from seed to current month
    let balance = startBalance;
    for (let k = 0; k <= elapsed; k++) {
      const rk =
        k === months - 3 ? 500_00 : k === months - 2 ? 1_500_00 : k === months - 1 ? 4_200_00 : 0;
      const bk = baseBurn + Math.round((Math.sin(k * 1.3) + 1) * 0.5 * burnJitter) + k * 200_00;
      balance -= bk - rk;
    }

    const notes =
      monthsRemaining === 0
        ? 'Latest snapshot — investor demo'
        : monthsRemaining === months - 1
          ? 'Seed round closed'
          : `Month -${monthsRemaining} · net burn ${(netBurn / 100).toFixed(0)}`;

    out.push({
      asOfDate: d,
      bankBalanceCents: Math.max(0, balance),
      revenueLast30dCents: revenueCents,
      notes,
    });
  }
  return out;
}

async function main() {
  const { clear, months } = parseArgs();

  // Ensure the placeholder user exists (FK isn't enforced on RunwayBalance.userId,
  // but we keep a row anyway so admin queries don't see a mystery id).
  await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    create: {
      id: DEMO_USER_ID,
      email: 'runway-demo-seed@polemicyst.local',
      name: 'Runway Demo Seed',
    },
    update: {},
  });

  if (clear) {
    const { count } = await prisma.runwayBalance.deleteMany({});
    console.log(`Cleared ${count} existing RunwayBalance rows.`);
  }

  const series = buildSeries(months);

  let upserted = 0;
  for (const row of series) {
    await prisma.runwayBalance.upsert({
      where: { asOfDate: row.asOfDate },
      create: {
        userId: DEMO_USER_ID,
        asOfDate: row.asOfDate,
        bankBalanceCents: row.bankBalanceCents,
        revenueLast30dCents: row.revenueLast30dCents,
        source: 'manual',
        notes: row.notes,
      },
      update: {
        bankBalanceCents: row.bankBalanceCents,
        revenueLast30dCents: row.revenueLast30dCents,
        notes: row.notes,
      },
    });
    upserted++;
  }

  console.log(`Seeded ${upserted} months of demo runway history:`);
  for (const row of series) {
    console.log(
      `  ${row.asOfDate.toISOString().slice(0, 10)}  balance=$${(row.bankBalanceCents / 100).toLocaleString()}  rev=$${(row.revenueLast30dCents / 100).toLocaleString()}`
    );
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
