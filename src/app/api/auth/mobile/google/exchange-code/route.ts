import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { serverAuthCode } = await req.json();
  if (!serverAuthCode) {
    return NextResponse.json({ error: 'Missing serverAuthCode' }, { status: 400 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  // Exchange the server auth code for tokens
  const params = new URLSearchParams({
    code: serverAuthCode,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: '',
  });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error('[exchange-code] Token exchange failed:', tokenRes.status, body);
    return NextResponse.json({ error: 'Token exchange failed' }, { status: 400 });
  }

  const data = await tokenRes.json();
  const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in as number);

  // Get Google user ID from userinfo so we can upsert the Account record
  const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });

  if (!userinfoRes.ok) {
    console.error('[exchange-code] Failed to fetch Google userinfo:', userinfoRes.status);
    return NextResponse.json({ error: 'Failed to verify Google identity' }, { status: 400 });
  }

  const userinfo = await userinfoRes.json();
  const googleAccountId: string = userinfo.sub;

  // Upsert: update existing Google account or create one for this user
  await prisma.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: 'google',
        providerAccountId: googleAccountId,
      },
    },
    update: {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? undefined,
      expires_at: expiresAt,
      scope: data.scope ?? null,
    },
    create: {
      userId: user.id,
      provider: 'google',
      providerAccountId: googleAccountId,
      type: 'oauth',
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: expiresAt,
      scope: data.scope ?? null,
      token_type: data.token_type ?? 'Bearer',
    },
  });

  return NextResponse.json({ success: true });
}
