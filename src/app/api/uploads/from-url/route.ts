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
    const { url, filename, transcript, transcriptSegments, transcriptSource } = await req.json();

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

    // Save transcript if provided by the client (iOS fetches captions client-side
    // from the user's device to bypass YouTube's datacenter IP bot detection).
    if (transcript && transcriptSegments) {
      try {
        await prisma.feedVideo.update({
          where: { id: newVideo.id },
          data: {
            transcript,
            transcriptJson: transcriptSegments as any,
            transcriptSource: transcriptSource || 'youtube-auto',
          },
        });
        console.info(
          `[from-url] Client-provided captions saved for ${newVideo.id} (${Array.isArray(transcriptSegments) ? transcriptSegments.length : '?'} segments, ${transcriptSource})`
        );
      } catch (err) {
        console.warn('[from-url] Failed to save client-provided captions:', err);
      }
    } else if (isYouTubeUrl(url)) {
      // Fall back to server-side caption fetching (may fail from datacenter IPs).
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
