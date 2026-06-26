import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const composition = await prisma.composition.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        status: true,
        outputs: {
          select: {
            id: true,
            layout: true,
            status: true,
            s3Url: true,
            renderError: true,
            durationMs: true,
            fileSizeBytes: true,
            transcript: true,
          },
        },
      },
    });

    if (!composition) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(serializeBigInts(composition));
  } catch (err) {
    console.error('[GET /api/compositions/[id]/render/status]', err);
    return NextResponse.json({ error: 'Failed to get render status' }, { status: 500 });
  }
}

/**
 * Recursively coerces BigInt values to plain JS numbers so `NextResponse.json`
 * (which uses standard `JSON.stringify`) doesn't throw "Do not know how to
 * serialize a BigInt". `CompositionOutput.fileSizeBytes` is a Prisma `BigInt?` —
 * once the stitch-render worker stamps it, this route would 500 without this guard.
 */
function serializeBigInts<T>(value: T): T {
  if (typeof value === 'bigint') {
    return Number(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map(serializeBigInts) as unknown as T;
  }
  // Only descend into plain objects — Date / Buffer / etc. have their own JSON
  // representations and recursing through them produces empty `{}` after
  // `Object.entries` enumeration.
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
