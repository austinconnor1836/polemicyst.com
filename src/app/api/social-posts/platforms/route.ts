import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';

interface SocialPlatformInfo {
  platform: string;
  displayName: string;
  connected: boolean;
  accountName?: string;
  supportsText: boolean;
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const oauthAccounts = await prisma.account.findMany({
    where: { userId: user.id },
    select: { provider: true, providerAccountId: true },
  });

  const providerSet = new Set(oauthAccounts.map((a) => a.provider));

  const platforms: SocialPlatformInfo[] = [
    {
      platform: 'twitter',
      displayName: 'X / Twitter',
      connected: providerSet.has('twitter'),
      supportsText: true,
    },
    {
      platform: 'facebook',
      displayName: 'Facebook',
      connected: providerSet.has('facebook') || providerSet.has('google'),
      supportsText: true,
    },
    {
      platform: 'bluesky',
      displayName: 'Bluesky',
      connected: providerSet.has('bluesky'),
      supportsText: true,
    },
    {
      platform: 'threads',
      displayName: 'Threads',
      connected: providerSet.has('threads') || providerSet.has('facebook'),
      supportsText: true,
    },
  ];

  const defaults = (user.defaultPublishPlatforms as string[] | null) ?? [];

  return NextResponse.json({ platforms, defaults });
}
