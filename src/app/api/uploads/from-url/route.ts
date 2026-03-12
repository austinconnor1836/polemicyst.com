import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { queueFeedDownloadJob } from '@shared/queues';
import { findOrCreateManualFeed, createFeedVideoRecord } from '@shared/services/upload-service';
import { extractYouTubeId } from '@/app/connected-accounts/util/thumbnails';
import { prisma } from '@shared/lib/prisma';
import {
  isYouTubeUrl,
  fetchYouTubeCaptions,
  fetchYouTubeCaptionsHTTP,
} from '@shared/lib/youtube-captions';

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { url, filename } = await req.json();

    if (!url || !String(url).startsWith('http')) {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }

    const manualFeed = await findOrCreateManualFeed(user.id);

    // Generate thumbnail for YouTube URLs
    const youtubeId = extractYouTubeId(url);
    const thumbnailUrl = youtubeId
      ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`
      : undefined;

    const newVideo = await createFeedVideoRecord({
      feedId: manualFeed.id,
      userId: user.id,
      title: filename || url.split('/').pop() || 'Imported Video',
      s3Url: url,
      status: 'pending',
      thumbnailUrl,
    });

    await queueFeedDownloadJob({
      feedVideoId: newVideo.id,
      url,
      title: newVideo.title,
      feedId: manualFeed.id,
      userId: user.id,
    });

    // For YouTube URLs, fetch captions inline so the transcript is
    // available immediately without needing the clip-metadata-worker.
    // Try pure HTTP first (~100ms), fall back to yt-dlp (~3s).
    if (isYouTubeUrl(url)) {
      try {
        let captions = await fetchYouTubeCaptionsHTTP(url);
        if (!captions) {
          captions = await fetchYouTubeCaptions(url);
        }
        if (captions) {
          await prisma.feedVideo.update({
            where: { id: newVideo.id },
            data: {
              transcript: captions.transcript,
              transcriptJson: captions.segments as any,
              transcriptSource: captions.source,
            },
          });
          console.info(
            `[from-url] YouTube captions saved for ${newVideo.id} (${captions.segments.length} segments, ${captions.source})`
          );
        }
      } catch (err) {
        // Non-fatal — transcript can be fetched later by the worker
        console.warn('[from-url] Inline caption fetch failed:', err);
      }
    }

    return NextResponse.json(newVideo);
  } catch (error) {
    console.error('Import from URL error:', error);
    return NextResponse.json({ error: 'Failed to register video' }, { status: 500 });
  }
}
