import { getServerSession } from 'next-auth/next';
import { NextRequest } from 'next/server';
import { prisma } from './prisma';
import { getSessionFromBearer } from './auth';

/**
 * Unified auth helper for API routes.
 * Tries web session (NextAuth cookies) first, then falls back to mobile Bearer JWT.
 * Returns the Prisma User or null. Never throws — auth failures return null.
 */
export async function getAuthenticatedUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const hasBearerToken = !!authHeader?.startsWith('Bearer ');

  try {
    // Lazy-import authOptions to avoid circular dependencies
    const { authOptions } = await import('../../auth');

    // 1. Try web session (cookies)
    const session = (await getServerSession(authOptions)) as {
      user?: { email?: string; id?: string };
    } | null;
    if (session?.user?.email) {
      const user = await prisma.user.findUnique({
        where: { email: session.user.email },
      });
      if (user) return user;
    }
  } catch (err) {
    console.error('[auth-helpers] getServerSession failed:', err);
  }

  try {
    // 2. Fall back to mobile Bearer JWT
    const mobileSession = await getSessionFromBearer(req);
    if (mobileSession?.id) {
      const user = await prisma.user.findUnique({
        where: { id: mobileSession.id },
      });
      if (user) return user;
      console.warn(`[auth-helpers] Bearer JWT valid but user not found: ${mobileSession.id}`);
    } else if (hasBearerToken) {
      console.warn('[auth-helpers] Bearer token present but decode returned null');
    }
  } catch (err) {
    console.error('[auth-helpers] Bearer auth failed:', err);
  }

  if (hasBearerToken) {
    console.warn(
      `[auth-helpers] Auth failed for ${req.nextUrl.pathname} (Bearer token present but invalid)`
    );
  }
  return null;
}
