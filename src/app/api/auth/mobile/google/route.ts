import { NextRequest, NextResponse } from 'next/server';
import { encode } from 'next-auth/jwt';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '@shared/lib/prisma';

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
    AUTH_ALLOWED_EMAILS.includes(email.toLowerCase()) && AUTH_ALLOWED_PROVIDERS.includes('google')
  );
}

/**
 * Exchange a Google server auth code for access + refresh tokens
 * and store them in the Account row.
 */
async function exchangeServerAuthCode(accountId: string, serverAuthCode: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(
      '[mobile-google-auth] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET for code exchange'
    );
    return;
  }

  const params = new URLSearchParams({
    code: serverAuthCode,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: '', // empty for mobile flows
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('[mobile-google-auth] Code exchange failed:', res.status, body);
    return;
  }

  const data = await res.json();
  const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in as number);

  await prisma.account.update({
    where: { id: accountId },
    data: {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? null,
      expires_at: expiresAt,
      scope: data.scope ?? null,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const { idToken, serverAuthCode } = await req.json();
    if (!idToken) {
      return NextResponse.json({ error: 'Missing idToken' }, { status: 400 });
    }

    const audience = [process.env.GOOGLE_CLIENT_ID!, process.env.GOOGLE_IOS_CLIENT_ID!].filter(
      Boolean
    );
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken,
      audience,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { email, name, picture, sub: googleId } = payload;

    if (!isAllowed(email)) {
      return NextResponse.json({ error: 'Email not allowed' }, { status: 403 });
    }

    // Find or create user
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: { email, name: name ?? null, image: picture ?? null },
      });
    }

    // Upsert Google account
    const account = await prisma.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: 'google',
          providerAccountId: googleId!,
        },
      },
      update: {},
      create: {
        userId: user.id,
        provider: 'google',
        providerAccountId: googleId!,
        type: 'oauth',
      },
    });

    // If a server auth code was provided, exchange it for access + refresh tokens
    if (serverAuthCode) {
      try {
        await exchangeServerAuthCode(account.id, serverAuthCode);
      } catch (err) {
        console.error('[mobile-google-auth] Server auth code exchange failed (non-blocking):', err);
      }
    }

    // Mint a NextAuth-compatible JWT
    const token = await encode({
      token: {
        sub: user.id,
        email: user.email,
        name: user.name,
        picture: user.image,
        id: user.id,
      },
      secret: process.env.NEXTAUTH_SECRET!,
    });

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
      },
    });
  } catch (error: any) {
    console.error('[mobile-google-auth] Error:', error.message);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
  }
}
