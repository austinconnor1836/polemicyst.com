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
import {
  isInstagramUrl,
  resolveInstagramMediaUrl,
  InstagramSessionUnavailableError,
} from '@shared/lib/instagram-captions';
import { getValidGoogleToken } from '@shared/lib/google-token';
import { logUpload, getUploadContext } from '@shared/lib/upload-logger';

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startMs = Date.now();
  const { userAgent } = getUploadContext(req);

  try {
    const { url, filename, transcript, transcriptSegments, transcriptSource, captionError } =
      await req.json();

    if (!url || !String(url).startsWith('http')) {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }

    const manualFeed = await findOrCreateManualFeed(user.id);

    // Instagram path — resolve mp4 URL via instagram-private-api, then hand the
    // CDN URL to the existing Whisper transcription worker. IG has no native
    // transcript surface (see shared/lib/instagram-captions.ts for the full
    // design note); we only fetch the media URL + author-written post caption
    // here. `postCaption` is intentionally NOT written into `transcript` — it's
    // author-written text, not spoken-word.
    if (isInstagramUrl(url)) {
      let mp4Url: string;
      let postCaption: string | undefined;
      let shortcode: string;
      try {
        const resolved = await resolveInstagramMediaUrl(url);
        mp4Url = resolved.mp4Url;
        postCaption = resolved.postCaption;
        shortcode = resolved.shortcode;
      } catch (err) {
        if (err instanceof InstagramSessionUnavailableError) {
          await logUpload({
            userId: user.id,
            stage: 'from-url',
            status: 'failed',
            filename: filename || url,
            durationMs: Date.now() - startMs,
            error: err.message,
            userAgent,
            metadata: { url, reason: 'instagram-session-unavailable' },
          });
          return NextResponse.json(
            {
              error: 'Instagram integration not configured',
              detail: err.message,
            },
            { status: 503 }
          );
        }
        throw err;
      }

      const newVideo = await createFeedVideoRecord({
        feedId: manualFeed.id,
        userId: user.id,
        title: filename || `Instagram ${shortcode}`,
        s3Url: mp4Url,
        status: 'ready',
      });

      // NOTE: the author-written post caption is intentionally NOT written into
      // `transcript` / `transcriptJson` — those fields are reserved for the
      // Whisper transcript that the transcription worker will produce next.
      // We log the caption + return it to the client for surfacing separately;
      // persisting it as a first-class column is deferred to a follow-up PR to
      // keep this change minimal.
      if (postCaption) {
        console.info(
          `[from-url] Instagram post caption for ${newVideo.id} (${postCaption.length} chars, not persisted)`
        );
      }

      await queueTranscriptionJob({ feedVideoId: newVideo.id }).catch((err) =>
        console.warn('[from-url] Failed to queue Instagram transcription:', err)
      );

      const durationMs = Date.now() - startMs;
      await logUpload({
        userId: user.id,
        stage: 'from-url',
        status: 'success',
        filename: filename || url,
        durationMs,
        userAgent,
        metadata: {
          feedVideoId: newVideo.id,
          url,
          source: 'instagram',
          shortcode,
          hasPostCaption: !!postCaption,
        },
      });

      console.info(
        `[upload:from-url] SUCCESS instagram user=${user.id} feedVideoId=${newVideo.id} shortcode=${shortcode} (${durationMs}ms)`
      );

      // Return the feedVideo shape the URL importer expects, plus the
      // separately-named `postCaption` field so the client can surface the
      // author-written text distinctly from the (upcoming) Whisper transcript.
      return NextResponse.json({ ...newVideo, postCaption });
    }

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
        `[from-url] No client-provided captions (transcript=${!!transcript}, segments=${!!transcriptSegments})${captionError ? ` — iOS error: ${captionError}` : ''}`
      );
    }

    if (!captionsSaved && isYouTubeUrl(url)) {
      // Try server-side caption fetching — use OAuth token if available
      try {
        const googleToken = await getValidGoogleToken(user.id).catch(() => null);
        let captions = await fetchYouTubeCaptionsHTTP(url, googleToken || undefined);
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

    const durationMs = Date.now() - startMs;
    await logUpload({
      userId: user.id,
      stage: 'from-url',
      status: 'success',
      filename: filename || url,
      durationMs,
      userAgent,
      metadata: {
        feedVideoId: newVideo.id,
        url,
        captionsSaved,
        transcriptSource: transcriptSource || null,
        captionError: captionError || null,
      },
    });

    console.info(
      `[upload:from-url] SUCCESS user=${user.id} feedVideoId=${newVideo.id} url=${url} captions=${captionsSaved} (${durationMs}ms)`
    );

    return NextResponse.json(newVideo);
  } catch (error) {
    const durationMs = Date.now() - startMs;
    const errMsg = error instanceof Error ? error.message : String(error);

    await logUpload({
      userId: user.id,
      stage: 'from-url',
      status: 'failed',
      durationMs,
      error: errMsg,
      userAgent,
      metadata: { stack: error instanceof Error ? error.stack : undefined },
    });

    console.error(`[upload:from-url] FAILED user=${user.id} error=${errMsg} (${durationMs}ms)`);
    return NextResponse.json(
      { error: 'Failed to register video', detail: errMsg },
      { status: 500 }
    );
  }
}
