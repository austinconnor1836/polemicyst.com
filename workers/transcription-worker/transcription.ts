const fetch = require('node-fetch');
import { prisma } from '@shared/lib/prisma';
import { spawn } from 'child_process';
import { fetchYouTubeCaptions, isYouTubeUrl } from '@shared/lib/youtube-captions';

export async function transcribeFeedVideo(
  feedVideoId: string
): Promise<{ transcript: string; segments: any[] }> {
  console.info('🔍 Checking for existing transcript...');

  const feedVideo = await prisma.feedVideo.findUnique({ where: { id: feedVideoId } });

  if (!feedVideo?.s3Url) {
    throw new Error('Feed video not found or missing S3 URL');
  }

  if (feedVideo.transcript && feedVideo.transcriptJson) {
    console.info('✅ Transcript already exists, skipping transcription');
    return {
      transcript: feedVideo.transcript,
      segments: feedVideo.transcriptJson as any[],
    };
  }

  // Fast path: try YouTube captions before downloading + Whisper
  const youtubeUrl = findYouTubeUrl(feedVideo);
  if (youtubeUrl) {
    console.info('⚡ Attempting YouTube captions fast path...');
    try {
      const captions = await fetchYouTubeCaptions(youtubeUrl);
      if (captions) {
        console.info(
          `✅ Got transcript from ${captions.source} (${captions.segments.length} segments)`
        );
        await prisma.feedVideo.update({
          where: { id: feedVideoId },
          data: {
            transcript: captions.transcript,
            transcriptJson: captions.segments as any,
            transcriptSource: captions.source,
          },
        });
        return { transcript: captions.transcript, segments: captions.segments };
      }
      console.info('⚠️ No YouTube captions available, falling back to Whisper...');
    } catch (err) {
      console.warn('⚠️ YouTube captions fetch failed, falling back to Whisper:', err);
    }
  }

  console.info('🎤 Starting Whisper transcription...');

  const videoRes = await fetch(feedVideo.s3Url);
  if (!videoRes.ok || !videoRes.body) {
    throw new Error('Failed to fetch video stream from S3');
  }

  const pythonProcess = spawn('python3', ['/app/scripts/transcribe.py', '-'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let output = '';
  let error = '';
  let streamEnded = false;

  videoRes.body.on('error', (err: NodeJS.ErrnoException) => {
    console.error('Error reading video stream:', err);
    pythonProcess.stdin?.destroy(err);
  });

  pythonProcess.stdin?.on('error', (err) => {
    const errorWithCode = err as NodeJS.ErrnoException;
    if (errorWithCode.code === 'EPIPE') {
      console.error('EPIPE: Python process closed stdin early.');
    } else {
      console.error('Error writing to python stdin:', err);
    }
  });

  pythonProcess.on('close', () => {
    if (!streamEnded) {
      videoRes.body.unpipe(pythonProcess.stdin!);
      pythonProcess.stdin?.destroy();
    }
  });

  videoRes.body.on('end', () => {
    streamEnded = true;
  });

  videoRes.body.pipe(pythonProcess.stdin!);

  pythonProcess.stdout.on('data', (d: Buffer) => (output += d.toString()));
  pythonProcess.stderr.on('data', (d: Buffer) => (error += d.toString()));

  const exitCode: number = await new Promise((resolve) => pythonProcess.on('close', resolve));

  if (exitCode !== 0) {
    console.error('Python stderr:', error);
    throw new Error(`Transcription failed: ${error}`);
  }

  let parsed: { transcript: string; segments: any[] };
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error('Failed to parse transcript output');
  }

  await prisma.feedVideo.update({
    where: { id: feedVideoId },
    data: {
      transcript: parsed.transcript,
      transcriptJson: parsed.segments,
      transcriptSource: 'whisper',
    },
  });

  return parsed;
}

/**
 * Find a YouTube URL for the feed video. The s3Url may be either a YouTube URL
 * directly (pre-download) or an S3 URL. We also check if the videoId looks like
 * a YouTube ID so we can reconstruct the URL.
 */
function findYouTubeUrl(feedVideo: { s3Url: string; videoId?: string }): string | null {
  if (isYouTubeUrl(feedVideo.s3Url)) {
    return feedVideo.s3Url;
  }
  if (
    feedVideo.videoId &&
    /^[a-zA-Z0-9_-]{11}$/.test(feedVideo.videoId)
  ) {
    return `https://www.youtube.com/watch?v=${feedVideo.videoId}`;
  }
  return null;
}
