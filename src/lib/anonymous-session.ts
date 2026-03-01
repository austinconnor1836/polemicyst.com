import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth';
import { prisma } from '@shared/lib/prisma';
import { randomUUID } from 'crypto';

const ANON_COOKIE = 'anon_session';
export const ANON_UPLOAD_LIMIT = 2;

export interface ResolvedUser {
  id: string;
  email: string | null;
  subscriptionPlan: string;
  isAnonymous: boolean;
}

interface ResolveResult {
  user: ResolvedUser;
  newAnonId?: string;
}

/**
 * Resolves the current user from either an authenticated NextAuth session
 * or an anonymous session cookie. Creates a new anonymous user if neither
 * exists.
 *
 * Returns `newAnonId` when a fresh anonymous user was created — the caller
 * must set this as the `anon_session` cookie on the response via `withAnonCookie`.
 */
export async function resolveUser(): Promise<ResolveResult> {
  const session = await getServerSession(authOptions);
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });
    if (user) {
      return {
        user: {
          id: user.id,
          email: user.email,
          subscriptionPlan: user.subscriptionPlan,
          isAnonymous: false,
        },
      };
    }
  }

  const cookieStore = await cookies();
  const anonId = cookieStore.get(ANON_COOKIE)?.value;

  if (anonId) {
    const user = await prisma.user.findUnique({ where: { id: anonId } });
    if (user) {
      return {
        user: {
          id: user.id,
          email: null,
          subscriptionPlan: 'free',
          isAnonymous: true,
        },
      };
    }
  }

  const id = randomUUID();
  await prisma.user.create({ data: { id, name: 'Anonymous' } });

  return {
    user: { id, email: null, subscriptionPlan: 'free', isAnonymous: true },
    newAnonId: id,
  };
}

/** Attaches the `anon_session` cookie to a response when a new anonymous user was created. */
export function withAnonCookie(response: NextResponse, newAnonId?: string): NextResponse {
  if (newAnonId) {
    response.cookies.set(ANON_COOKIE, newAnonId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  }
  return response;
}

/** Checks whether an anonymous user has remaining upload slots. */
export async function checkAnonUploadLimit(userId: string) {
  const count = await prisma.feedVideo.count({ where: { userId } });
  return { allowed: count < ANON_UPLOAD_LIMIT, count, limit: ANON_UPLOAD_LIMIT };
}

export { ANON_COOKIE };
