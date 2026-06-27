import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

/**
 * POST /api/publish/video
 *
 * Stub for the generic "publish a video to platforms" flow. Today: just records the
 * intent (caption + platforms + source) so the iOS UI can wire end-to-end. Real per-
 * platform posting (YouTube Shorts, Instagram Reels, X, Bluesky, TikTok) lives in
 * follow-up workers.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { sourceKind, sourceId, title, caption, platforms } = body as {
      sourceKind?: string;
      sourceId?: string;
      title?: string;
      caption?: string;
      platforms?: string[];
    };

    if (!sourceKind || !sourceId || !Array.isArray(platforms) || platforms.length === 0) {
      return NextResponse.json(
        { error: 'sourceKind, sourceId, and a non-empty platforms[] are required' },
        { status: 400 }
      );
    }

    const supported = new Set(['youtube', 'instagram', 'twitter', 'bluesky', 'tiktok']);
    const queued = platforms.filter((p) => supported.has(p));
    const unsupported = platforms.filter((p) => !supported.has(p));

    if (unsupported.length > 0) {
      console.warn('[POST /api/publish/video] ignoring unsupported platforms:', unsupported);
    }

    // For now, just log. A future iteration will:
    //   1. Resolve sourceKind/sourceId into a CompositionOutput / Clip and its s3Url
    //   2. Persist a `PublishRequest` record + a `PublishRequestPlatform` row per platform
    //   3. Enqueue per-platform jobs (Twitter media upload, Bluesky video API, etc.)
    console.log('[POST /api/publish/video] queued', {
      userId: user.id,
      sourceKind,
      sourceId,
      platforms: queued,
      titlePreview: (title ?? '').slice(0, 80),
      captionPreview: (caption ?? '').slice(0, 80),
    });

    return NextResponse.json({
      publishRequestId: `stub-${Date.now()}`,
      queuedPlatforms: queued,
    });
  } catch (err) {
    console.error('[POST /api/publish/video] error', err);
    return NextResponse.json({ error: 'Failed to queue publish' }, { status: 500 });
  }
}
