import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { checkFeedQuota, checkAutoGenerateAccess } from '@/lib/plans';
import { getUserFeeds, createFeed, detectSourceType } from '@shared/services/feed-service';

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const feeds = await getUserFeeds(user.id);
  return NextResponse.json(feeds);
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const quota = await checkFeedQuota(user.id, user.subscriptionPlan);
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error: quota.message,
        code: 'QUOTA_EXCEEDED',
        limit: quota.limit,
        usage: quota.currentUsage,
      },
      { status: 403 }
    );
  }

  const data = await req.json();
  const { name, sourceUrl, pollingInterval, autoGenerateClips, viralitySettings } = data;

  if (autoGenerateClips) {
    const autoAccess = checkAutoGenerateAccess(user.subscriptionPlan);
    if (!autoAccess.allowed) {
      return NextResponse.json(
        { error: autoAccess.message, code: 'PLAN_RESTRICTED' },
        { status: 403 }
      );
    }
  }

  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }
  if (!sourceUrl || !String(sourceUrl).trim()) {
    return NextResponse.json({ error: 'Source URL is required' }, { status: 400 });
  }

  try {
    detectSourceType(String(sourceUrl));
  } catch {
    return NextResponse.json(
      {
        error:
          'Unsupported feed URL. Currently supported sources are YouTube and C-SPAN. Please paste a channel/playlist URL.',
      },
      { status: 400 }
    );
  }

  const newFeed = await createFeed(user.id, {
    name,
    sourceUrl,
    pollingInterval,
    autoGenerateClips,
    viralitySettings,
  });

  return NextResponse.json(newFeed);
}
