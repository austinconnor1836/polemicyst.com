import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { getValidGoogleToken } from '@shared/lib/google-token';
import {
  fetchCaptionsViaInnertubeAuth,
  fetchInnertubePlayer,
  getBestStreamingUrl,
} from '@shared/lib/innertube';
import { extractVideoId, isYouTubeUrl } from '@shared/lib/youtube-captions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/feedVideos/:id/innertube-transcribe
 *
 * Uses the user's Google OAuth token to fetch captions via YouTube's innertube
 * player API. This is the preferred method because:
 * 1. It uses a real authenticated session (no bot detection)
 * 2. No yt-dlp or Python dependencies required
 * 3. Works from any server (datacenter or residential IP)
 *
 * Optional body: { runAnalysis?: boolean, analysisProvider?: 'gemini' | 'ollama' }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { runAnalysis?: boolean; analysisProvider?: string } = {};
  try {
    body = await req.json();
  } catch {
    // No body is fine — defaults apply
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

  // Find the YouTube video ID
  const youtubeVideoId = extractYouTubeVideoId(feedVideo);
  if (!youtubeVideoId) {
    return NextResponse.json(
      { error: 'Not a YouTube video — innertube transcription requires a YouTube URL' },
      { status: 400 }
    );
  }

  // Get the user's Google OAuth token
  const accessToken = await getValidGoogleToken(user.id);
  if (!accessToken) {
    return NextResponse.json(
      { error: 'No Google account linked. Sign in with Google to use innertube transcription.' },
      { status: 403 }
    );
  }

  try {
    // Fetch captions via authenticated innertube
    const captions = await fetchCaptionsViaInnertubeAuth(youtubeVideoId, accessToken);

    if (!captions) {
      return NextResponse.json(
        { error: 'No English captions available for this video' },
        { status: 404 }
      );
    }

    // Save transcript to DB
    await prisma.feedVideo.update({
      where: { id: feedVideo.id },
      data: {
        transcript: captions.transcript,
        transcriptJson: captions.segments as any,
        transcriptSource: captions.source,
      },
    });

    // Optionally also fetch streaming URL metadata
    let streamingUrl: string | null = null;
    try {
      const playerData = await fetchInnertubePlayer(youtubeVideoId, accessToken);
      if (playerData) {
        streamingUrl = getBestStreamingUrl(playerData);
      }
    } catch {
      // Non-fatal — streaming URL is bonus info
    }

    return NextResponse.json({
      ok: true,
      transcript: captions.transcript,
      segments: captions.segments,
      source: captions.source,
      segmentCount: captions.segments.length,
      streamingUrl,
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
