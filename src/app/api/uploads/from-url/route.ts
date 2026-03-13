import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { queueFeedDownloadJob, queueTranscriptionJob } from '@shared/queues';
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

    // Save transcript: try client-provided first, then server-side, then queue worker fallback.
    let captionsSaved = false;

    if (transcript && transcriptSegments) {
      // Client-side captions (iOS fetches from user's device to bypass bot detection)
      try {
        await prisma.feedVideo.update({
          where: { id: newVideo.id },
          data: {
            transcript,
            transcriptJson: transcriptSegments as any,
            transcriptSource: transcriptSource || 'youtube-auto',
          },
        });
        captionsSaved = true;
        console.info(
          `[from-url] Client-provided captions saved for ${newVideo.id} (${Array.isArray(transcriptSegments) ? transcriptSegments.length : '?'} segments, ${transcriptSource})`
        );
      } catch (err) {
        console.warn('[from-url] Failed to save client-provided captions:', err);
      }
    } else {
      console.info(
        `[from-url] No client-provided captions (transcript=${!!transcript}, segments=${!!transcriptSegments})`
      );
    }

    if (!captionsSaved && isYouTubeUrl(url)) {
      // Try server-side caption fetching (may fail from datacenter IPs)
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
          captionsSaved = true;
          console.info(
            `[from-url] YouTube captions saved for ${newVideo.id} (${captions.segments.length} segments, ${captions.source})`
          );
        }
      } catch (err) {
        console.warn('[from-url] Inline caption fetch failed:', err);
      }

      // Always queue transcription job as fallback for YouTube URLs.
      // The worker will retry YouTube captions + fall back to Whisper after download.
      if (!captionsSaved) {
        console.info(
          `[from-url] Queuing transcription job for ${newVideo.id} (inline fetch failed)`
        );
        await queueTranscriptionJob({ feedVideoId: newVideo.id }).catch((err) =>
          console.warn('[from-url] Failed to queue transcription:', err)
        );
      }
    }

    return NextResponse.json(newVideo);
  } catch (error) {
    console.error('Import from URL error:', error);
    return NextResponse.json({ error: 'Failed to register video' }, { status: 500 });
  }
}
