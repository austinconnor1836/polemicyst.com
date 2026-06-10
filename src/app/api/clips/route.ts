import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

/**
 * Clips are currently stored as `Video` rows.
 * Preferred identification: `sourceVideoId != null` (generated clips referencing a source video).
 * Back-compat: older clips may have `sourceVideoId == null` but use an S3 key suffix `-clip.mp4`.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Cap the result set so heavy users don't time out the request. 100 is enough to
    // populate the Clips screen with the most recent generations; pagination can come
    // later if a user actually has more relevant clips than that.
    const clips = await prisma.video.findMany({
      where: {
        userId: user.id,
        OR: [
          { sourceVideoId: { not: null } },
          {
            AND: [{ s3Key: { endsWith: '-clip.mp4' } }, { fileName: '' }],
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        sourceVideo: {
          select: { id: true, videoTitle: true, s3Url: true },
        },
      },
    });

    return NextResponse.json(clips);
  } catch (err) {
    console.error('[GET /api/clips] Unhandled error:', err);
    return NextResponse.json({ error: 'Failed to load clips' }, { status: 500 });
  }
}
