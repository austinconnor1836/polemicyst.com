import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { accessToken } = await req.json();
  if (!accessToken) {
    return NextResponse.json({ error: 'Missing accessToken' }, { status: 400 });
  }

  // Verify the token and get user info from Facebook Graph API
  const fbRes = await fetch(
    `https://graph.facebook.com/v19.0/me?fields=id,name,email&access_token=${accessToken}`
  );

  if (!fbRes.ok) {
    const body = await fbRes.text();
    console.error('[facebook/exchange-token] Graph API verification failed:', fbRes.status, body);
    return NextResponse.json({ error: 'Invalid Facebook access token' }, { status: 400 });
  }

  const fbUser = await fbRes.json();
  const facebookUserId: string = fbUser.id;

  // Upsert: update existing Facebook account or create one for this user
  await prisma.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: 'facebook',
        providerAccountId: facebookUserId,
      },
    },
    update: {
      access_token: accessToken,
    },
    create: {
      userId: user.id,
      provider: 'facebook',
      providerAccountId: facebookUserId,
      type: 'oauth',
      access_token: accessToken,
      token_type: 'Bearer',
    },
  });

  return NextResponse.json({
    success: true,
    name: fbUser.name ?? null,
    facebookUserId,
  });
}
