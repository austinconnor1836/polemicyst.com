// /src/app/api/connected-accounts/[id]/poll-status/route.ts
//
// W015 — Polling progress endpoint. Returns lightweight status used by the
// PollingStatusBanner on the Connected Accounts page after a user connects a
// new feed so we can show "Checking YouTube…" until the first FeedVideo lands.

import { NextRequest } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { notFound, ok, unauthorized } from '@shared/lib/api-response';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return unauthorized();
  }

  const feed = await prisma.videoFeed.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      lastCheckedAt: true,
      pollingInterval: true,
    },
  });

  if (!feed || feed.userId !== user.id) {
    return notFound('Feed not found');
  }

  const videoCount = await prisma.feedVideo.count({ where: { feedId: id } });

  // pollingInterval is stored in minutes — convert to ms when projecting the
  // next check timestamp. If we've never polled yet there's nothing to derive.
  let nextPollAt: string | null = null;
  if (feed.lastCheckedAt && Number.isFinite(feed.pollingInterval)) {
    const nextMs = feed.lastCheckedAt.getTime() + feed.pollingInterval * 60_000;
    nextPollAt = new Date(nextMs).toISOString();
  }

  return ok({
    feedId: feed.id,
    lastPolledAt: feed.lastCheckedAt ? feed.lastCheckedAt.toISOString() : null,
    nextPollAt,
    hasFirstVideo: videoCount > 0,
    videoCount,
  });
}
