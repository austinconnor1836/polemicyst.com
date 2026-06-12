import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { isAdmin } from '@shared/lib/admin';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';

/**
 * POST /api/admin/runway/balance
 *
 * Record a balance snapshot (founder updates monthly).
 *
 * Body: {
 *   bankBalanceUsd: number,         // dollars; converted to cents
 *   revenueLast30dUsd?: number,     // dollars; converted to cents
 *   asOfDate?: string,              // ISO; defaults to today (UTC midnight)
 *   notes?: string,
 *   source?: 'manual' | 'plaid' | 'stripe',
 * }
 */
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!isAdmin(user?.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const b = (body ?? {}) as {
    bankBalanceUsd?: number;
    revenueLast30dUsd?: number;
    asOfDate?: string;
    notes?: string;
    source?: string;
  };

  if (typeof b.bankBalanceUsd !== 'number' || !Number.isFinite(b.bankBalanceUsd)) {
    return NextResponse.json(
      { error: 'bankBalanceUsd is required and must be a finite number' },
      { status: 400 }
    );
  }

  const bankBalanceCents = Math.round(b.bankBalanceUsd * 100);
  const revenueLast30dCents = Math.round((b.revenueLast30dUsd ?? 0) * 100);

  // Normalize asOfDate to UTC midnight so multiple snapshots on the same day
  // collide on the unique constraint (we upsert).
  const raw = b.asOfDate ? new Date(b.asOfDate) : new Date();
  const asOfDate = new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate()));

  const source = b.source ?? 'manual';

  const record = await prisma.runwayBalance.upsert({
    where: { asOfDate },
    create: {
      userId: user!.id,
      asOfDate,
      bankBalanceCents,
      revenueLast30dCents,
      source,
      notes: b.notes ?? null,
    },
    update: {
      bankBalanceCents,
      revenueLast30dCents,
      source,
      notes: b.notes ?? null,
    },
  });

  return NextResponse.json({
    id: record.id,
    asOfDate: record.asOfDate,
    bankBalanceUsd: record.bankBalanceCents / 100,
    revenueLast30dUsd: record.revenueLast30dCents / 100,
    source: record.source,
    notes: record.notes,
  });
}
