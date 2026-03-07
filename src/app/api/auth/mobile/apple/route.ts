import { NextRequest, NextResponse } from 'next/server';
import { encode } from 'next-auth/jwt';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { prisma } from '@shared/lib/prisma';

const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID || 'com.polemicyst.app';

const AUTH_ALLOWLIST_ENABLED = process.env.AUTH_ALLOWLIST_ENABLED === 'true';
const AUTH_ALLOWED_EMAILS = (process.env.AUTH_ALLOWED_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const AUTH_ALLOWED_PROVIDERS = (process.env.AUTH_ALLOWED_PROVIDERS ?? 'google')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isAllowed(email: string): boolean {
  if (!AUTH_ALLOWLIST_ENABLED) return true;
  if (!AUTH_ALLOWED_EMAILS.length) return false;
  return (
    AUTH_ALLOWED_EMAILS.includes(email.toLowerCase()) && AUTH_ALLOWED_PROVIDERS.includes('apple')
  );
}

export async function POST(req: NextRequest) {
  try {
    const { identityToken, fullName } = await req.json();
    if (!identityToken) {
      return NextResponse.json({ error: 'Missing identityToken' }, { status: 400 });
    }

    // Verify Apple identity token
    const { payload } = await jwtVerify(identityToken, APPLE_JWKS, {
      issuer: 'https://appleid.apple.com',
      audience: APPLE_CLIENT_ID,
    });

    const appleUserId = payload.sub;
    const email = payload.email as string | undefined;

    if (!appleUserId) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Apple only sends email on the first sign-in; subsequent logins omit it.
    // Try to find user by Apple account first, then by email.
    let user: Awaited<ReturnType<typeof prisma.user.findUnique>> = null;

    // Check existing Apple account link
    const existingAccount = await prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'apple',
          providerAccountId: appleUserId,
        },
      },
      include: { user: true },
    });

    if (existingAccount) {
      user = existingAccount.user;
    } else if (email) {
      // First sign-in: try to match by email
      if (!isAllowed(email)) {
        return NextResponse.json({ error: 'Email not allowed' }, { status: 403 });
      }

      user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        // Build display name from Apple-provided fullName (only sent on first auth)
        const displayName =
          fullName?.givenName && fullName?.familyName
            ? `${fullName.givenName} ${fullName.familyName}`
            : (fullName?.givenName ?? null);

        user = await prisma.user.create({
          data: {
            email,
            name: displayName,
          },
        });
      }

      // Link Apple account
      await prisma.account.create({
        data: {
          userId: user.id,
          provider: 'apple',
          providerAccountId: appleUserId,
          type: 'oauth',
        },
      });
    } else {
      // No email and no existing account — can't proceed
      return NextResponse.json(
        { error: 'Unable to identify user. Please try again.' },
        { status: 401 }
      );
    }

    // Mint a NextAuth-compatible JWT
    const token = await encode({
      token: {
        sub: user!.id,
        email: user!.email,
        name: user!.name,
        picture: user!.image,
        id: user!.id,
      },
      secret: process.env.NEXTAUTH_SECRET!,
    });

    return NextResponse.json({
      token,
      user: {
        id: user!.id,
        email: user!.email,
        name: user!.name,
        image: user!.image,
      },
    });
  } catch (error: any) {
    console.error('[mobile-apple-auth] Error:', error.message);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
  }
}
