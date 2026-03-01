import { NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { encode } from 'next-auth/jwt';

const DEV_USER_EMAIL = process.env.DEV_USER_EMAIL;
const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  if (!DEV_USER_EMAIL) {
    return NextResponse.json(
      { error: 'Set DEV_USER_EMAIL env var to the email of the account to log in as' },
      { status: 400 }
    );
  }

  if (!secret) {
    return NextResponse.json(
      { error: 'NEXTAUTH_SECRET or AUTH_SECRET must be set' },
      { status: 500 }
    );
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

  const token = await encode({
    token: {
      sub: user.id,
      email: user.email,
      name: user.name,
      picture: user.image,
    },
    secret,
    maxAge: 30 * 24 * 60 * 60,
  });

  const secureCookie = process.env.NEXTAUTH_URL?.startsWith('https');
  const cookieName = secureCookie ? '__Secure-next-auth.session-token' : 'next-auth.session-token';

  const response = NextResponse.redirect(
    new URL('/', process.env.NEXTAUTH_URL || 'http://localhost:3000')
  );

  response.cookies.set(cookieName, token, {
    httpOnly: true,
    secure: !!secureCookie,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });

  return response;
}
