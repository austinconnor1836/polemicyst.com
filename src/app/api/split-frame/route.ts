import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { ok, serverError, unauthorized } from '@shared/lib/api-response';

/**
 * GET /api/split-frame
 *
 * Returns the caller's Split-Frame compositions (mode = 'split-frame'),
 * newest first, each with its `renderConfig` (the manifest) + latest output.
 * Used by the iOS `MySplitFramesView` list.
 *
 * BigInt-aware serialization — `CompositionOutput.fileSizeBytes` is BigInt in
 * Prisma; without the coercion `NextResponse.json` throws once any row has
 * a completed render.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorized();

    const rows = await prisma.composition.findMany({
      where: { userId: user.id, mode: 'split-frame' },
      orderBy: { updatedAt: 'desc' },
      include: {
        outputs: {
          orderBy: { updatedAt: 'desc' },
        },
      },
    });

    return ok(rows.map(serializeBigInts));
  } catch (err) {
    return serverError('Failed to load split-frame renders', err);
  }
}

/**
 * Recursively coerces BigInt values to plain JS numbers so `NextResponse.json`
 * doesn't throw on Prisma `BigInt?` columns (mirrors the helper in
 * `/api/compositions`).
 */
function serializeBigInts<T>(value: T): T {
  if (typeof value === 'bigint') {
    return Number(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map(serializeBigInts) as unknown as T;
  }
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
