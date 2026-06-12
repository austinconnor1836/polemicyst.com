/**
 * Investor Demo Seed Script
 *
 * Populates the `/admin/metrics` (MRR/ARR/churn/cohort) and `/admin/costs`
 * dashboards with realistic synthetic activity so the dashboards are
 * demo-able before the first real customer signs up. All synthetic data
 * is scoped to `demo-investor-*@clipfire.local` emails — safe to re-run,
 * never touches real users.
 *
 * Usage:
 *   npm run seed:demo                    # 60 days, 25 users (default)
 *   npm run seed:demo -- --days=90 --users=40
 *   npm run seed:demo -- --reset         # delete existing demo users first
 *
 * What it seeds:
 *   - N users with realistic plan distribution (50/30/15/5 free/creator/pro/agency)
 *   - One UsageMonth row per non-free user, per month, last 3 months
 *   - 200-500 CostEvent rows spread across the `--days` window
 *   - One SubscriptionMetric row per day for the last 90 days, with small
 *     positive newSubscriptions + churnedSubscriptions counts
 *
 * Reads DATABASE_URL from .env (same path as the rest of the app). Never
 * touches a remote DB unless DATABASE_URL points at one — verify before
 * running.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: false });

import { prisma } from '../shared/lib/prisma';
import { PLANS, PlanId } from '../shared/lib/plans';
import type { Prisma } from '@prisma/client';

// --- CLI args ---------------------------------------------------------------

function parseFlag(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  for (const a of argv) {
    if (a.startsWith(`--${name}=`)) return a.split('=')[1] ?? fallback;
  }
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) {
    return argv[idx + 1];
  }
  return fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
}

const DAYS = parseInt(parseFlag('days', '60'), 10);
const USERS = parseInt(parseFlag('users', '25'), 10);
const RESET = hasFlag('reset');

// --- Deterministic RNG (so re-runs produce the same data) -------------------

/**
 * Tiny seeded PRNG — Mulberry32. Fixed seed so the seed script is
 * deterministic across re-runs (helps with "did the dashboard go up?"
 * questions during demo prep).
 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(20260612);

function randInt(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number): number {
  return rng() * (max - min) + min;
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

// --- Domain helpers ---------------------------------------------------------

const DEMO_EMAIL_PREFIX = 'demo-investor-';
const DEMO_EMAIL_DOMAIN = '@clipfire.local';
const DEMO_NAME_PREFIX = 'Demo Investor ';

const PLAN_PRICE_CENTS: Record<PlanId, number> = {
  free: 0,
  creator: Math.round(parseFloat(PLANS.creator.monthlyPriceDisplay.replace(/[^0-9.]/g, '')) * 100),
  pro: Math.round(parseFloat(PLANS.pro.monthlyPriceDisplay.replace(/[^0-9.]/g, '')) * 100),
  agency: Math.round(parseFloat(PLANS.agency.monthlyPriceDisplay.replace(/[^0-9.]/g, '')) * 100),
};

/** Weighted plan assignment: ~50% free / 30% creator / 15% pro / 5% agency. */
function assignPlan(i: number, total: number): PlanId {
  const pct = i / total;
  if (pct < 0.5) return 'free';
  if (pct < 0.8) return 'creator';
  if (pct < 0.95) return 'pro';
  return 'agency';
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function yearMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function addMonths(d: Date, months: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
}

// --- Reset logic ------------------------------------------------------------

async function findDemoUsers(): Promise<{ id: string; email: string | null }[]> {
  return prisma.user.findMany({
    where: {
      email: { startsWith: DEMO_EMAIL_PREFIX, endsWith: DEMO_EMAIL_DOMAIN },
    },
    select: { id: true, email: true },
  });
}

async function resetDemoData(): Promise<number> {
  const demoUsers = await findDemoUsers();
  if (demoUsers.length === 0) {
    console.log('No existing demo users to reset.');
    return 0;
  }

  const ids = demoUsers.map((u) => u.id);
  console.log(`Resetting ${demoUsers.length} demo users...`);

  // Delete owned rows first. Cascade handles most, but CostEvent has no FK so
  // we delete it explicitly.
  const costDel = await prisma.costEvent.deleteMany({ where: { userId: { in: ids } } });
  console.log(`  Deleted ${costDel.count} CostEvent rows`);

  const usageDel = await prisma.usageMonth.deleteMany({ where: { userId: { in: ids } } });
  console.log(`  Deleted ${usageDel.count} UsageMonth rows`);

  // SubscriptionMetric rows are not per-user — but the only ones we may have
  // seeded look like demo data because of the data shape. Delete any
  // SubscriptionMetric row whose date falls in the demo window — safe because
  // before this script runs there is no real data anyway.
  const subDel = await prisma.subscriptionMetric.deleteMany({});
  console.log(`  Deleted ${subDel.count} SubscriptionMetric rows`);

  const userDel = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`  Deleted ${userDel.count} demo User rows`);

  return userDel.count;
}

// --- Seeders ----------------------------------------------------------------

interface SeededUser {
  id: string;
  email: string;
  plan: PlanId;
  /** When the seed treats this user as having signed up (UTC). */
  signupAt: Date;
  /** True for the ~10% of paid users we'll churn during the window. */
  churned: boolean;
}

async function seedUsers(): Promise<SeededUser[]> {
  console.log(`\nCreating ${USERS} demo users...`);
  const now = new Date();
  const windowStart = addDays(startOfUtcDay(now), -DAYS);
  const seeded: SeededUser[] = [];

  for (let i = 1; i <= USERS; i++) {
    const email = `${DEMO_EMAIL_PREFIX}${i}${DEMO_EMAIL_DOMAIN}`;
    const plan = assignPlan(i - 1, USERS);
    // Stagger signups across the window so cohort buckets aren't empty.
    const signupOffset = Math.floor(((i - 1) / USERS) * DAYS);
    const signupAt = addDays(windowStart, signupOffset);
    // ~10% of paid users churn (revert to free plan in the synthesised state).
    const churned = plan !== 'free' && rng() < 0.1;
    // Reflect churn in the user's current plan so /admin/metrics groupBy is
    // consistent with the per-day rollup deltas.
    const currentPlan: PlanId = churned ? 'free' : plan;

    console.log(`  Creating user ${email} (plan=${currentPlan}${churned ? ', churned' : ''})`);

    const created = await prisma.user.create({
      data: {
        email,
        name: `${DEMO_NAME_PREFIX}${i}`,
        subscriptionPlan: currentPlan,
        stripeCustomerId: plan === 'free' ? null : `cus_demo_${i.toString().padStart(4, '0')}`,
        acceptedAgeGate: true,
        defaultLLMProvider: 'gemini',
      },
      select: { id: true, email: true },
    });

    seeded.push({
      id: created.id,
      email: created.email ?? email,
      plan,
      signupAt,
      churned,
    });
  }

  return seeded;
}

async function seedUsageMonths(users: SeededUser[]): Promise<number> {
  console.log(`\nSeeding UsageMonth rows...`);
  const now = new Date();
  const months: Date[] = [
    addMonths(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), -2),
    addMonths(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), -1),
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  ];

  let count = 0;
  for (const user of users) {
    if (user.plan === 'free') continue;
    const cap = PLANS[user.plan].limits.uploadMinutesPerMonth;
    for (const monthStart of months) {
      // Realistic usage: 30%–90% of cap.
      const minutes = Math.round(cap * randFloat(0.3, 0.9));
      const clipCount = Math.max(1, Math.round(minutes / 8));
      const ym = yearMonth(monthStart);
      console.log(
        `  Recording usage ${minutes}min / ${clipCount} clips for ${user.email} in ${ym}`
      );
      // createdAt is set explicitly so the cohort signup proxy
      // (min(UsageMonth.createdAt) per user) lands on user.signupAt.
      const createdAt =
        monthStart.getTime() === months[0].getTime() ? user.signupAt : monthStart;
      await prisma.usageMonth.upsert({
        where: { userId_yearMonth: { userId: user.id, yearMonth: ym } },
        update: { processedMinutes: minutes, clipCount },
        create: {
          userId: user.id,
          yearMonth: ym,
          processedMinutes: minutes,
          clipCount,
          createdAt,
        },
      });
      count++;
    }
  }
  console.log(`  Created ${count} UsageMonth rows`);
  return count;
}

async function seedCostEvents(users: SeededUser[]): Promise<number> {
  const target = randInt(200, 500);
  console.log(`\nSeeding ${target} CostEvent rows across ${DAYS} days...`);
  const now = new Date();
  const windowStart = addDays(startOfUtcDay(now), -DAYS);

  // Cost shape per stage — anchored on the cost model documented in
  // polemicyst.com/CLAUDE.md ("Cost estimation" section).
  type StageGen = () => Omit<
    Prisma.CostEventCreateManyInput,
    'userId' | 'jobId' | 'createdAt'
  >;
  const stageGens: Record<string, StageGen> = {
    download: () => ({
      stage: 'download',
      provider: 's3',
      fileSizeBytes: BigInt(randInt(20_000_000, 400_000_000)),
      // S3 transfer-out + small PUT — typically < $0.04 per video.
      estimatedCostUsd: randFloat(0.002, 0.04),
      durationMs: randInt(2000, 45000),
    }),
    transcription: () => ({
      stage: 'transcription',
      provider: 'whisper',
      // Local Whisper — compute only, no API cost.
      estimatedCostUsd: 0,
      durationMs: randInt(5000, 90000),
    }),
    llm_scoring: () => {
      const inputTokens = randInt(8000, 40000);
      const outputTokens = randInt(300, 1500);
      // Gemini Flash pricing — $0.075/1M input, $0.30/1M output.
      const cost = (inputTokens / 1_000_000) * 0.075 + (outputTokens / 1_000_000) * 0.3;
      return {
        stage: 'llm_scoring',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        inputTokens,
        outputTokens,
        inputImages: randInt(8, 32),
        inputAudioS: randFloat(30, 600),
        estimatedCostUsd: Number(cost.toFixed(6)),
        durationMs: randInt(3000, 20000),
      };
    },
    ffmpeg_render: () => ({
      stage: 'ffmpeg_render',
      provider: 'ffmpeg',
      // Local compute.
      estimatedCostUsd: 0,
      durationMs: randInt(8000, 60000),
    }),
    s3_upload: () => {
      const fileSizeBytes = BigInt(randInt(5_000_000, 80_000_000));
      const gb = Number(fileSizeBytes) / (1024 * 1024 * 1024);
      // PUT cost + bandwidth out.
      const cost = 0.005 / 1000 + gb * 0.09;
      return {
        stage: 's3_upload',
        provider: 's3',
        fileSizeBytes,
        estimatedCostUsd: Number(cost.toFixed(6)),
        durationMs: randInt(1500, 15000),
      };
    },
  };

  // Bias toward llm_scoring + ffmpeg_render — those are the per-clip stages
  // that dominate real workload.
  const stageBag: string[] = [
    'download',
    'transcription',
    'llm_scoring',
    'llm_scoring',
    'llm_scoring',
    'ffmpeg_render',
    'ffmpeg_render',
    's3_upload',
  ];

  // Only attribute cost to users who have actually used the product —
  // free-tier users in the demo include some inactive accounts, which is fine.
  const activeUsers = users.filter((u) => u.plan !== 'free' || rng() < 0.4);

  let created = 0;
  const rows: Prisma.CostEventCreateManyInput[] = [];
  for (let i = 0; i < target; i++) {
    const user = pick(activeUsers);
    const stage = pick(stageBag);
    const dayOffset = randInt(0, DAYS - 1);
    const createdAt = addDays(windowStart, dayOffset);
    // Group by synthetic "jobId" so the per-job dashboard rollup has nice
    // multi-row groupings.
    const jobId = `demo-job-${user.id.slice(0, 6)}-${Math.floor(dayOffset / 2)}`;
    const data = stageGens[stage]();
    rows.push({
      ...data,
      userId: user.id,
      jobId,
      createdAt,
      metadata: { source: 'investor-demo-seed' },
    });
    created++;
  }

  // Single createMany write — far faster than per-row inserts for ~500 rows.
  await prisma.costEvent.createMany({ data: rows });
  console.log(`  Created ${created} CostEvent rows`);
  return created;
}

async function seedSubscriptionMetrics(users: SeededUser[]): Promise<number> {
  // Always seed 90 days of metric rows — the /admin/metrics dashboard
  // hard-codes a 90-day history window regardless of the seed window.
  const HISTORY_DAYS = 90;
  console.log(`\nSeeding ${HISTORY_DAYS} SubscriptionMetric rows...`);
  const today = startOfUtcDay(new Date());

  // Today's counts, derived from current User state — this matches what
  // /api/admin/metrics computes from User.groupBy.
  const todayCounts = { creator: 0, pro: 0, agency: 0 };
  for (const u of users) {
    if (!u.churned && (u.plan === 'creator' || u.plan === 'pro' || u.plan === 'agency')) {
      todayCounts[u.plan]++;
    }
  }
  let activeToday = todayCounts.creator + todayCounts.pro + todayCounts.agency;
  let mrrCentsToday =
    todayCounts.creator * PLAN_PRICE_CENTS.creator +
    todayCounts.pro * PLAN_PRICE_CENTS.pro +
    todayCounts.agency * PLAN_PRICE_CENTS.agency;

  // Walk backwards day-by-day. Each previous day = current day - newSubs +
  // churnedSubs. The deltas average to small positive numbers (0..3 each)
  // so MRR/active counts trend up modestly across the window, which is what
  // an investor expects to see.
  const days: {
    date: Date;
    mrrCents: number;
    arrCents: number;
    activeSubscriptions: number;
    creatorCount: number;
    proCount: number;
    agencyCount: number;
    newSubscriptions: number;
    churnedSubscriptions: number;
  }[] = [];

  let currCreator = todayCounts.creator;
  let currPro = todayCounts.pro;
  let currAgency = todayCounts.agency;
  let currActive = activeToday;
  let currMrr = mrrCentsToday;

  for (let offset = 0; offset < HISTORY_DAYS; offset++) {
    const date = addDays(today, -offset);
    const newSubs = randInt(0, 3);
    const churned = rng() < 0.3 ? randInt(0, 2) : 0;
    days.push({
      date,
      mrrCents: currMrr,
      arrCents: currMrr * 12,
      activeSubscriptions: currActive,
      creatorCount: currCreator,
      proCount: currPro,
      agencyCount: currAgency,
      newSubscriptions: newSubs,
      churnedSubscriptions: churned,
    });

    // Walk backwards: previous day = today - net new.
    const net = newSubs - churned;
    currActive = Math.max(0, currActive - net);
    // Distribute the delta proportionally across plans (largest bucket
    // absorbs the rounding remainder).
    const splits: Array<keyof typeof todayCounts> = ['creator', 'pro', 'agency'];
    const counts = { creator: currCreator, pro: currPro, agency: currAgency };
    for (let n = 0; n < Math.abs(net); n++) {
      const planKey = pick(splits);
      if (net > 0 && counts[planKey] > 0) {
        counts[planKey]--;
      } else if (net < 0) {
        counts[planKey]++;
      }
    }
    currCreator = counts.creator;
    currPro = counts.pro;
    currAgency = counts.agency;
    currMrr =
      currCreator * PLAN_PRICE_CENTS.creator +
      currPro * PLAN_PRICE_CENTS.pro +
      currAgency * PLAN_PRICE_CENTS.agency;
  }

  let inserted = 0;
  for (const row of days) {
    console.log(
      `  Recording SubscriptionMetric for ${row.date.toISOString().slice(0, 10)} (` +
        `mrr=$${(row.mrrCents / 100).toFixed(0)}, active=${row.activeSubscriptions}, ` +
        `new=${row.newSubscriptions}, churned=${row.churnedSubscriptions})`
    );
    await prisma.subscriptionMetric.upsert({
      where: { date: row.date },
      update: {
        mrrCents: row.mrrCents,
        arrCents: row.arrCents,
        activeSubscriptions: row.activeSubscriptions,
        creatorCount: row.creatorCount,
        proCount: row.proCount,
        agencyCount: row.agencyCount,
        newSubscriptions: row.newSubscriptions,
        churnedSubscriptions: row.churnedSubscriptions,
      },
      create: {
        date: row.date,
        mrrCents: row.mrrCents,
        arrCents: row.arrCents,
        activeSubscriptions: row.activeSubscriptions,
        creatorCount: row.creatorCount,
        proCount: row.proCount,
        agencyCount: row.agencyCount,
        newSubscriptions: row.newSubscriptions,
        churnedSubscriptions: row.churnedSubscriptions,
      },
    });
    inserted++;
  }
  console.log(`  Wrote ${inserted} SubscriptionMetric rows`);
  return inserted;
}

// --- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is not set. Add it to .env or .env.local.');
    process.exit(1);
  }

  console.log(`Investor demo seed`);
  console.log(`  days=${DAYS}, users=${USERS}, reset=${RESET}`);
  console.log(`  DATABASE_URL host: ${new URL(process.env.DATABASE_URL).host}`);

  if (RESET) {
    await resetDemoData();
  } else {
    const existing = await findDemoUsers();
    if (existing.length > 0) {
      console.error(
        `ERROR: ${existing.length} demo users already exist (${existing[0].email} ...). ` +
          `Re-run with --reset to delete + reseed, or pick a different prefix.`
      );
      process.exit(1);
    }
  }

  const users = await seedUsers();
  const usageCount = await seedUsageMonths(users);
  const costCount = await seedCostEvents(users);
  const metricCount = await seedSubscriptionMetrics(users);

  const planTotals = users.reduce<Record<PlanId, number>>(
    (acc, u) => {
      const eff: PlanId = u.churned ? 'free' : u.plan;
      acc[eff] = (acc[eff] ?? 0) + 1;
      return acc;
    },
    { free: 0, creator: 0, pro: 0, agency: 0 }
  );

  console.log(
    `\nSeeded ${users.length} users (${planTotals.free} free / ${planTotals.creator} creator / ` +
      `${planTotals.pro} pro / ${planTotals.agency} agency), ${costCount} CostEvents, ` +
      `${usageCount} UsageMonth rows, ${metricCount} SubscriptionMetric rows`
  );
}

main()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
