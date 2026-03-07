import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { encode } from 'next-auth/jwt';

const DEV_USER_EMAIL = process.env.DEV_USER_EMAIL;
const DEV_LOGIN_SECRET = process.env.DEV_LOGIN_SECRET;
const jwtSecret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;

const AUTH_ALLOWLIST_ENABLED = process.env.AUTH_ALLOWLIST_ENABLED === 'true';
const AUTH_ALLOWED_EMAILS = (process.env.AUTH_ALLOWED_EMAILS ?? '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!DEV_USER_EMAIL || !DEV_LOGIN_SECRET) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const token = req.nextUrl.searchParams.get('token');
  if (!token || token !== DEV_LOGIN_SECRET) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (AUTH_ALLOWLIST_ENABLED && AUTH_ALLOWED_EMAILS.length > 0) {
    if (!AUTH_ALLOWED_EMAILS.includes(DEV_USER_EMAIL.toLowerCase())) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
  }

  if (!jwtSecret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  let user = await prisma.user.findUnique({ where: { email: DEV_USER_EMAIL } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: DEV_USER_EMAIL,
        name: DEV_USER_EMAIL.split('@')[0],
      },
    });
  }

  const sessionToken = await encode({
    token: {
      sub: user.id,
      email: user.email,
      name: user.name,
      picture: user.image,
    },
    secret: jwtSecret,
    maxAge: 30 * 24 * 60 * 60,
  });

  const secureCookie = process.env.NEXTAUTH_URL?.startsWith('https');
  const cookieName = secureCookie ? '__Secure-next-auth.session-token' : 'next-auth.session-token';

  const response = NextResponse.redirect(
    new URL('/', process.env.NEXTAUTH_URL || 'http://localhost:3000')
  );

  response.cookies.set(cookieName, sessionToken, {
    httpOnly: true,
    secure: !!secureCookie,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });

  return response;
}
