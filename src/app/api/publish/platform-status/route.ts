import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';

/**
 * Global publishing platform connection status. Unlike
 * /api/compositions/[id]/publish/platforms which is tied to a composition,
 * this endpoint is used by the Publishing Destinations settings page and
 * the sidebar connection badge. It's cheap — a single account lookup.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const oauthAccounts = await prisma.account.findMany({
    where: { userId: user.id },
    select: { provider: true },
  });

  const providers = new Set(oauthAccounts.map((a) => a.provider));

  const platforms = [
    { platform: 'youtube', connected: providers.has('google') },
    { platform: 'facebook', connected: providers.has('facebook') || providers.has('google') },
    { platform: 'instagram', connected: providers.has('facebook') || providers.has('google') },
    { platform: 'twitter', connected: providers.has('twitter') },
    { platform: 'bluesky', connected: providers.has('bluesky') },
    { platform: 'threads', connected: providers.has('threads') || providers.has('facebook') },
  ];

  const connectedCount = platforms.filter((p) => p.connected).length;

  return NextResponse.json({
    platforms,
    connectedCount,
    totalCount: platforms.length,
  });
}
