import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { queueFeedDownloadJob } from '@shared/queues';
import { findOrCreateManualFeed, createFeedVideoRecord } from '@shared/services/upload-service';
import { extractYouTubeId } from '@/app/connected-accounts/util/thumbnails';
import { prisma } from '@shared/lib/prisma';
import { isYouTubeUrl, fetchYouTubeCaptionsHTTP } from '@shared/lib/youtube-captions';

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

    // For YouTube URLs, fetch captions inline (pure HTTP, ~100ms).
    // This makes the transcript available immediately without needing
    // the clip-metadata-worker to be running.
    if (isYouTubeUrl(url)) {
      try {
        const captions = await fetchYouTubeCaptionsHTTP(url);
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
            `[from-url] Inline YouTube captions saved for ${newVideo.id} (${captions.segments.length} segments)`
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
