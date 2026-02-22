import { decode } from 'next-auth/jwt';
import { NextRequest } from 'next/server';

/**
 * Extract and verify a Bearer JWT token from the Authorization header.
 * Returns the decoded token payload (same shape as NextAuth JWT) or null.
 *
 * Usage in API routes:
 *   const session = await getServerSession(authOptions);
 *   const mobileSession = !session ? await getSessionFromBearer(req) : null;
 *   const userId = session?.user?.id ?? mobileSession?.id;
 */
export async function getSessionFromBearer(
  req: NextRequest
): Promise<{ id: string; email: string; name?: string; picture?: string } | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  if (!token) return null;

  try {
    const decoded = await decode({
      token,
      secret: process.env.NEXTAUTH_SECRET!,
    });

    if (!decoded?.sub || !decoded?.email) return null;

    return {
      id: (decoded as any).id ?? decoded.sub,
      email: decoded.email as string,
      name: decoded.name as string | undefined,
      picture: decoded.picture as string | undefined,
    };
  } catch {
    return null;
  }
}
