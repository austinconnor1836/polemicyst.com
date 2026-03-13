import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/feedVideos/:id/save-transcript
 *
 * Saves a client-provided transcript to an existing FeedVideo.
 * Used when the iOS app fetches captions client-side (innertube from device)
 * and needs to persist them on the server.
 *
 * Body: { transcript: string, segments: TranscriptSegment[], source: string }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const feedVideo = await prisma.feedVideo.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });

  if (!feedVideo || feedVideo.userId !== user.id) {
    return NextResponse.json({ error: 'Feed video not found' }, { status: 404 });
  }

  let body: { transcript?: string; segments?: any[]; source?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!body.transcript || !body.segments || !Array.isArray(body.segments) || body.segments.length === 0) {
    return NextResponse.json({ error: 'Missing transcript or segments' }, { status: 400 });
  }

  await prisma.feedVideo.update({
    where: { id },
    data: {
      transcript: body.transcript,
      transcriptJson: body.segments as any,
      transcriptSource: body.source || 'youtube-auto',
    },
  });

  console.info(
    `[save-transcript] Saved client-provided transcript for ${id} (${body.segments.length} segments, ${body.source})`
  );

  return NextResponse.json({
    ok: true,
    segmentCount: body.segments.length,
    source: body.source,
  });
}
