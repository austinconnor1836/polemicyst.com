import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { notFound, ok, serverError, unauthorized } from '@shared/lib/api-response';

/**
 * GET /api/split-frame/[id]
 *
 * Returns one Split-Frame composition owned by the caller, with its outputs.
 * iOS polls this while a render is in flight to see when the `split-frame`
 * output's `status` flips to `completed` (with a populated `s3Url`) or
 * `failed`.
 *
 * Same `mode = 'split-frame'` scope as the list endpoint so a stitch/reaction
 * composition can't be fetched through this URL by mistake.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorized();

    const { id } = await params;

    const row = await prisma.composition.findFirst({
      where: { id, userId: user.id, mode: 'split-frame' },
      include: { outputs: { orderBy: { updatedAt: 'desc' } } },
    });
    if (!row) return notFound('Split-frame render not found');

    return ok(serializeBigInts(row));
  } catch (err) {
    return serverError('Failed to load split-frame render', err);
  }
}

/**
 * DELETE /api/split-frame/[id]
 *
 * Removes a Split-Frame composition (cascade drops outputs). The S3 objects
 * are left behind — same convention as stitch/reaction renders; a lifecycle
 * policy on the `split-frame/` prefix handles eventual cleanup.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorized();

    const { id } = await params;

    const row = await prisma.composition.findFirst({
      where: { id, userId: user.id, mode: 'split-frame' },
      select: { id: true },
    });
    if (!row) return notFound('Split-frame render not found');

    await prisma.composition.delete({ where: { id: row.id } });
    return ok({ deleted: true });
  } catch (err) {
    return serverError('Failed to delete split-frame render', err);
  }
}

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
