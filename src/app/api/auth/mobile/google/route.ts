import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { encode } from 'next-auth/jwt';
import { OAuth2Client } from 'google-auth-library';

const prisma = new PrismaClient();

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

export async function POST(req: NextRequest) {
  try {
    const { idToken } = await req.json();
    if (!idToken) {
      return NextResponse.json({ error: 'Missing idToken' }, { status: 400 });
    }

    const audience = [
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_IOS_CLIENT_ID!,
    ].filter(Boolean);
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
    await prisma.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: 'google',
          providerAccountId: googleId!,
        },
      },
      update: {
        access_token: null,
        refresh_token: null,
      },
      create: {
        userId: user.id,
        provider: 'google',
        providerAccountId: googleId!,
        type: 'oauth',
      },
    });

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
