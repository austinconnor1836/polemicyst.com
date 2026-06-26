import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { isAdmin } from '@shared/lib/admin';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';

/**
 * GET /api/admin/runway
 *
 * Returns runway snapshot, monthly burn (computed from CostEvent + fixed overhead),
 * 12-month balance projection, and expense breakdown by category.
 */

// Fixed monthly overhead (USD) not captured by per-clip CostEvent rows.
// These approximate Vercel/AWS baseline + DB + Redis spend. Editable here so the
// number stays honest as infra changes. Pulled from AWS budget alert + invoice.
const FIXED_MONTHLY_OVERHEAD_USD: Record<string, number> = {
  aws_compute: 90, // NAT GW + ECS + Fargate baseline
  vercel: 20, // Next.js hosting
  database: 19, // Postgres (e.g. Supabase / Neon)
  redis: 10, // Upstash / ElastiCache
};

const STAGE_TO_CATEGORY: Record<string, string> = {
  llm_scoring: 'LLM',
  truth_chat: 'LLM',
  download: 'S3',
  s3_upload: 'S3',
  transcription: 'Compute',
  ffmpeg_render: 'Compute',
};

function stageCategory(stage: string): string {
  return STAGE_TO_CATEGORY[stage] ?? 'Other';
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!isAdmin(user?.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Latest balance snapshot
  const latestBalance = await prisma.runwayBalance.findFirst({
    orderBy: { asOfDate: 'desc' },
  });

  // History (last 24 snapshots) for context + sparkline
  const balanceHistory = await prisma.runwayBalance.findMany({
    orderBy: { asOfDate: 'desc' },
    take: 24,
  });

  // Compute monthly burn from CostEvent last 30 days
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const recentEvents = await prisma.costEvent.findMany({
    where: { createdAt: { gte: since } },
    select: {
      stage: true,
      estimatedCostUsd: true,
      userId: true,
      createdAt: true,
    },
  });

  // Variable burn = sum of CostEvent over actual N days, scaled to 30
  // (handles freshly-deployed DBs that don't yet have 30 days of data).
  let earliest = since.getTime();
  for (const e of recentEvents) {
    const t = new Date(e.createdAt).getTime();
    if (t < earliest) earliest = t;
  }
  const now = Date.now();
  const observedDays = Math.max(1, Math.round((now - earliest) / 86_400_000));
  const observedTotal = recentEvents.reduce((sum, e) => sum + (e.estimatedCostUsd || 0), 0);
  const variableMonthlyBurn = (observedTotal / observedDays) * 30;

  const fixedMonthlyBurn = Object.values(FIXED_MONTHLY_OVERHEAD_USD).reduce((a, b) => a + b, 0);
  const monthlyBurnUsd = variableMonthlyBurn + fixedMonthlyBurn;

  // Expense breakdown by category (variable + fixed)
  const variableByCategory: Record<string, number> = {};
  for (const e of recentEvents) {
    const cat = stageCategory(e.stage);
    variableByCategory[cat] = (variableByCategory[cat] ?? 0) + (e.estimatedCostUsd || 0);
  }
  // Scale variable to a 30d view
  const scale = 30 / observedDays;
  for (const k of Object.keys(variableByCategory)) {
    variableByCategory[k] = variableByCategory[k] * scale;
  }
  const categoryRows = [
    { category: 'LLM', amountUsd: variableByCategory['LLM'] ?? 0 },
    { category: 'S3', amountUsd: variableByCategory['S3'] ?? 0 },
    { category: 'Compute', amountUsd: variableByCategory['Compute'] ?? 0 },
    { category: 'Other', amountUsd: variableByCategory['Other'] ?? 0 },
    { category: 'DB', amountUsd: FIXED_MONTHLY_OVERHEAD_USD.database },
    {
      category: 'Hosting',
      amountUsd:
        FIXED_MONTHLY_OVERHEAD_USD.vercel +
        FIXED_MONTHLY_OVERHEAD_USD.aws_compute +
        FIXED_MONTHLY_OVERHEAD_USD.redis,
    },
  ].sort((a, b) => b.amountUsd - a.amountUsd);

  // Cost per active user
  const activeUserIds = new Set<string>();
  for (const e of recentEvents) {
    if (e.userId) activeUserIds.add(e.userId);
  }
  const activeUserCount = activeUserIds.size;
  const costPerActiveUserUsd = activeUserCount > 0 ? (observedTotal * scale) / activeUserCount : 0;

  // Current balance + revenue
  const currentBalanceUsd = latestBalance ? latestBalance.bankBalanceCents / 100 : 0;
  const monthlyRevenueUsd = latestBalance ? latestBalance.revenueLast30dCents / 100 : 0;
  const netBurnUsd = Math.max(0, monthlyBurnUsd - monthlyRevenueUsd);
  const runwayMonths = netBurnUsd > 0 ? currentBalanceUsd / netBurnUsd : Infinity;

  // Runway end date — null if infinite (revenue >= burn)
  let runwayEndDate: string | null = null;
  if (Number.isFinite(runwayMonths) && netBurnUsd > 0) {
    const end = new Date();
    end.setDate(end.getDate() + Math.round(runwayMonths * 30));
    runwayEndDate = end.toISOString();
  }

  // 12-month projection (monthly checkpoints)
  const projection: { month: string; balanceUsd: number }[] = [];
  let bal = currentBalanceUsd;
  const startDate = latestBalance ? new Date(latestBalance.asOfDate) : new Date();
  for (let i = 0; i <= 12; i++) {
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + i);
    projection.push({
      month: d.toISOString().slice(0, 7), // YYYY-MM
      balanceUsd: Math.max(0, Math.round(bal)),
    });
    bal -= netBurnUsd;
  }

  return NextResponse.json({
    currentBalanceUsd,
    monthlyRevenueUsd,
    monthlyBurnUsd,
    netBurnUsd,
    runwayMonths: Number.isFinite(runwayMonths) ? runwayMonths : null,
    runwayEndDate,
    asOfDate: latestBalance?.asOfDate ?? null,
    activeUserCount,
    costPerActiveUserUsd,
    variableMonthlyBurn,
    fixedMonthlyBurn,
    fixedBreakdown: FIXED_MONTHLY_OVERHEAD_USD,
    categoryBreakdown: categoryRows,
    projection,
    balanceHistory: balanceHistory.map((b) => ({
      id: b.id,
      asOfDate: b.asOfDate,
      bankBalanceUsd: b.bankBalanceCents / 100,
      revenueLast30dUsd: b.revenueLast30dCents / 100,
      source: b.source,
      notes: b.notes,
    })),
    observedDays,
  });
}
