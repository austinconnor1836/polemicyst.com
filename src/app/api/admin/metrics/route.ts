import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { isAdmin } from '@shared/lib/admin';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';

interface ByPlan {
  creator: number;
  pro: number;
  agency: number;
}

interface HistoryRow {
  date: string;
  mrrCents: number;
  arrCents: number;
  activeSubscriptions: number;
  newSubscriptions: number;
  churnedSubscriptions: number;
}

interface CohortRow {
  signupMonth: string;
  totalSignups: number;
  /** stillActive[i] = users still on a paid plan i months after signup. */
  stillActive: number[];
}

/** Returns the UTC year-month bucket string ("YYYY-MM") for a Date. */
function yearMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Returns the first UTC day of a given year-month bucket. */
function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Number of whole months elapsed between two Dates (UTC year + month math). */
function monthsBetween(start: Date, end: Date): number {
  return (
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth())
  );
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!isAdmin(user?.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // --- Today's snapshot ------------------------------------------------------
  // Active subscription counts are computed from the User table — that's the
  // authoritative source. The rollup row is the daily ledger; using `User` for
  // the "right now" snapshot avoids drift if rollup writes lagged.
  const grouped = await prisma.user.groupBy({
    by: ['subscriptionPlan'],
    _count: true,
  });
  const byPlan: ByPlan = { creator: 0, pro: 0, agency: 0 };
  let activeSubscriptions = 0;
  for (const row of grouped) {
    const plan = row.subscriptionPlan;
    // Legacy `business` plan maps to agency.
    const normalized = plan === 'business' ? 'agency' : plan;
    if (normalized === 'creator' || normalized === 'pro' || normalized === 'agency') {
      byPlan[normalized] += row._count;
      activeSubscriptions += row._count;
    }
  }

  // MRR/ARR for "today" — take the most recent rollup row if one exists; if
  // not, fall back to deriving from the User counts using a static lookup
  // (Plan monthly cents).
  const latestRollup = await prisma.subscriptionMetric.findFirst({
    orderBy: { date: 'desc' },
  });

  let mrrCents = latestRollup?.mrrCents ?? 0;
  if (mrrCents === 0 && activeSubscriptions > 0) {
    // Static fallback so the dashboard isn't blank on a fresh deploy.
    const { PLANS } = await import('@shared/lib/plans');
    const parse = (s: string): number => {
      const n = Number(s.replace(/[^0-9.]/g, ''));
      return Number.isFinite(n) ? Math.round(n * 100) : 0;
    };
    mrrCents =
      byPlan.creator * parse(PLANS.creator.monthlyPriceDisplay) +
      byPlan.pro * parse(PLANS.pro.monthlyPriceDisplay) +
      byPlan.agency * parse(PLANS.agency.monthlyPriceDisplay);
  }
  const arrCents = mrrCents * 12;

  // --- 90-day MRR / signup / churn history ----------------------------------
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 90);
  const historyRows = await prisma.subscriptionMetric.findMany({
    where: { date: { gte: since } },
    orderBy: { date: 'asc' },
  });
  const history: HistoryRow[] = historyRows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    mrrCents: r.mrrCents,
    arrCents: r.arrCents,
    activeSubscriptions: r.activeSubscriptions,
    newSubscriptions: r.newSubscriptions,
    churnedSubscriptions: r.churnedSubscriptions,
  }));

  // --- Churn % (last 30d) ---------------------------------------------------
  const thirtyDayAgo = new Date();
  thirtyDayAgo.setUTCDate(thirtyDayAgo.getUTCDate() - 30);
  const churnAgg = await prisma.subscriptionMetric.aggregate({
    where: { date: { gte: thirtyDayAgo } },
    _sum: { churnedSubscriptions: true, newSubscriptions: true },
  });
  const churned30d = churnAgg._sum.churnedSubscriptions ?? 0;
  const churnPct =
    activeSubscriptions > 0 ? (churned30d / (activeSubscriptions + churned30d)) * 100 : 0;

  // --- Monthly signup cohort retention (last 6 months) ----------------------
  // The User table doesn't track createdAt, so we use UsageMonth.createdAt — the
  // first time a user generated usage — as a signup proxy. For each cohort
  // bucket we count distinct users whose first UsageMonth row landed in that
  // month, then check how many of them currently have a non-free plan.
  // Current-state retention is the standard approximation when we don't keep
  // plan-history rows: anyone still paid counts as retained in every elapsed
  // month; future months are encoded as -1 so the UI can render "--".
  const now = new Date();
  const cohort: CohortRow[] = [];
  const PAID_PLANS = ['creator', 'pro', 'agency', 'business'];

  // One round-trip: pull each user's earliest UsageMonth.createdAt + their
  // current plan, then bucket in-memory.
  type SignupProxyRow = { userId: string; signupAt: Date; plan: string };
  const signupProxyRaw = await prisma.$queryRaw<SignupProxyRow[]>`
    SELECT um."userId" AS "userId",
           MIN(um."createdAt") AS "signupAt",
           u."subscriptionPlan" AS plan
    FROM "UsageMonth" um
    JOIN "User" u ON u.id = um."userId"
    GROUP BY um."userId", u."subscriptionPlan"
  `;

  for (let i = 5; i >= 0; i--) {
    const cohortStart = startOfMonth(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    );
    const cohortEnd = startOfMonth(
      new Date(Date.UTC(cohortStart.getUTCFullYear(), cohortStart.getUTCMonth() + 1, 1))
    );

    const bucket = signupProxyRaw.filter(
      (r) => r.signupAt >= cohortStart && r.signupAt < cohortEnd
    );
    const totalSignups = bucket.length;
    const stillPaidNow = bucket.filter((r) => PAID_PLANS.includes(r.plan)).length;

    const elapsedMonths = Math.min(monthsBetween(cohortStart, now), 5);
    const stillActive: number[] = [];
    for (let m = 0; m <= 5; m++) {
      if (m === 0) {
        stillActive.push(totalSignups);
      } else if (m <= elapsedMonths) {
        stillActive.push(stillPaidNow);
      } else {
        stillActive.push(-1);
      }
    }

    cohort.push({
      signupMonth: yearMonth(cohortStart),
      totalSignups,
      stillActive,
    });
  }

  return NextResponse.json({
    today: {
      mrrCents,
      arrCents,
      activeSubscriptions,
      byPlan,
      churnPct30d: Number(churnPct.toFixed(2)),
    },
    history,
    cohort,
  });
}
