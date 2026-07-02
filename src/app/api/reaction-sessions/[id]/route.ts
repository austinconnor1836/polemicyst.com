import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

/**
 * Recursively coerce BigInt values to numbers so `NextResponse.json` doesn't throw on
 * `CompositionOutput.fileSizeBytes` (Prisma `BigInt?`). Mirrors the helper in
 * `src/app/api/compositions/route.ts`.
 */
function serializeBigInts<T>(value: T): T {
  if (typeof value === 'bigint') return Number(value) as unknown as T;
  if (Array.isArray(value)) return value.map(serializeBigInts) as unknown as T;
  if (
    value &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  ) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeBigInts(v);
    }
    return out as T;
  }
  return value;
}

/** GET /api/reaction-sessions/[id] — session + child compositions (with tracks + outputs). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const session = await prisma.reactionSession.findFirst({
      where: { id, userId: user.id },
      include: {
        compositions: {
          orderBy: { createdAt: 'asc' },
          include: { outputs: true },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ error: 'Reaction session not found' }, { status: 404 });
    }

    return NextResponse.json(serializeBigInts(session));
  } catch (err) {
    console.error('[GET /api/reaction-sessions/[id]]', err);
    return NextResponse.json({ error: 'Failed to load reaction session' }, { status: 500 });
  }
}

/** DELETE /api/reaction-sessions/[id] — removes the session; child compositions are detached. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const session = await prisma.reactionSession.findFirst({ where: { id, userId: user.id } });
    if (!session) {
      return NextResponse.json({ error: 'Reaction session not found' }, { status: 404 });
    }

    await prisma.reactionSession.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/reaction-sessions/[id]]', err);
    return NextResponse.json({ error: 'Failed to delete reaction session' }, { status: 500 });
  }
}
