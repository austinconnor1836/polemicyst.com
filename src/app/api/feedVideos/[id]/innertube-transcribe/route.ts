import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { fetchCaptionsViaInnertubeAuth } from '@shared/lib/innertube';
import { extractVideoId, isYouTubeUrl } from '@shared/lib/youtube-captions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/feedVideos/:id/innertube-transcribe
 *
 * Attempts to fetch captions via YouTube's innertube player API.
 * This is a best-effort server-side attempt — innertube blocks datacenter IPs,
 * so this mainly works when the server has a residential IP or proxy.
 * The iOS app's client-side innertube (from the device's residential IP) is
 * the more reliable path.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const feedVideo = await prisma.feedVideo.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      videoId: true,
      s3Url: true,
      transcript: true,
      transcriptJson: true,
    },
  });

  if (!feedVideo || feedVideo.userId !== user.id) {
    return NextResponse.json({ error: 'Feed video not found' }, { status: 404 });
  }

  // Return existing transcript if available
  if (feedVideo.transcript && feedVideo.transcriptJson) {
    return NextResponse.json({
      ok: true,
      alreadyTranscribed: true,
      transcript: feedVideo.transcript,
      segmentCount: Array.isArray(feedVideo.transcriptJson)
        ? (feedVideo.transcriptJson as any[]).length
        : 0,
    });
  }

  const youtubeVideoId = extractYouTubeVideoId(feedVideo);
  if (!youtubeVideoId) {
    return NextResponse.json(
      { error: 'Not a YouTube video — innertube transcription requires a YouTube URL' },
      { status: 400 }
    );
  }

  try {
    const captions = await fetchCaptionsViaInnertubeAuth(youtubeVideoId);

    if (!captions) {
      return NextResponse.json(
        { error: 'No English captions available for this video (server-side innertube blocked)' },
        { status: 404 }
      );
    }

    await prisma.feedVideo.update({
      where: { id: feedVideo.id },
      data: {
        transcript: captions.transcript,
        transcriptJson: captions.segments as any,
        transcriptSource: captions.source,
      },
    });

    return NextResponse.json({
      ok: true,
      transcript: captions.transcript,
      segments: captions.segments,
      source: captions.source,
      segmentCount: captions.segments.length,
    });
  } catch (err: any) {
    console.error('[innertube-transcribe] Failed:', err);
    return NextResponse.json(
      { error: err.message || 'Innertube transcription failed' },
      { status: 500 }
    );
  }
}

function extractYouTubeVideoId(feedVideo: {
  videoId?: string | null;
  s3Url?: string | null;
}): string | null {
  if (feedVideo.s3Url && isYouTubeUrl(feedVideo.s3Url)) {
    return extractVideoId(feedVideo.s3Url);
  }
  if (feedVideo.videoId && /^[a-zA-Z0-9_-]{11}$/.test(feedVideo.videoId)) {
    return feedVideo.videoId;
  }
  return null;
}
