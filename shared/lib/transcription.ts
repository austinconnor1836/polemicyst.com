const fetch = require('node-fetch');
import { prisma } from './prisma';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';
import {
  fetchYouTubeCaptions,
  isYouTubeUrl,
  extractVideoId,
} from './youtube-captions';
import { fetchCaptionsViaInnertubeAuth } from './innertube';
import { getValidGoogleToken } from './google-token';

export async function transcribeFeedVideo(
  feedVideoId: string,
  localFilePath?: string
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
  if (youtubeUrl && !localFilePath) {
    console.info('⚡ Attempting YouTube captions fast path...');

    // Try authenticated innertube first (most reliable for YouTube)
    const videoId = extractVideoId(youtubeUrl);
    if (videoId && feedVideo.userId) {
      try {
        const token = await getValidGoogleToken(feedVideo.userId).catch(() => null);
        if (token) {
          const authCaptions = await fetchCaptionsViaInnertubeAuth(videoId, token);
          if (authCaptions) {
            console.info(
              `✅ Got transcript via innertube (auth) — ${authCaptions.source} (${authCaptions.segments.length} segments)`
            );
            await prisma.feedVideo.update({
              where: { id: feedVideoId },
              data: {
                transcript: authCaptions.transcript,
                transcriptJson: authCaptions.segments as any,
                transcriptSource: authCaptions.source,
              },
            });
            return { transcript: authCaptions.transcript, segments: authCaptions.segments };
          }
        }
      } catch (err) {
        console.warn('⚠️ Authenticated innertube failed, trying yt-dlp fallback:', err);
      }
    }

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

  const tempDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  let tempFilePath = localFilePath;
  let shouldCleanup = false;

  try {
    if (!tempFilePath) {
      tempFilePath = path.join(tempDir, `${randomUUID()}.mp4`);
      shouldCleanup = true;

      console.info(`⬇️ Downloading to ${tempFilePath}...`);

      if (feedVideo.s3Url.includes('youtube.com') || feedVideo.s3Url.includes('youtu.be')) {
        console.info('📹 Detected YouTube URL, using yt-dlp...');
        const ytdlp = spawn('yt-dlp', [
          '-f',
          'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
          '-o',
          tempFilePath,
          feedVideo.s3Url,
        ]);

        let ytError = '';
        ytdlp.stderr.on('data', (d: Buffer) => (ytError += d.toString()));

        const downloadExitCode = await new Promise((resolve) => ytdlp.on('close', resolve));
        if (downloadExitCode !== 0) {
          throw new Error(`yt-dlp failed: ${ytError}`);
        }
      } else {
        const videoRes = await fetch(feedVideo.s3Url);
        if (!videoRes.ok || !videoRes.body) {
          throw new Error('Failed to fetch video stream from S3');
        }
        await pipeline(videoRes.body, fs.createWriteStream(tempFilePath));
      }

      console.info('✅ Download complete.');
    } else {
      console.info(`✅ Using provided local video: ${tempFilePath}`);
    }

    const pythonPath = process.env.PYTHON_PATH || 'python3';
    const pythonProcess = spawn(pythonPath, ['scripts/transcribe.py', tempFilePath], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let error = '';

    pythonProcess.stdout.on('data', (d: Buffer) => (output += d.toString()));
    pythonProcess.stderr.on('data', (d: Buffer) => (error += d.toString()));

    const exitCode: number = await new Promise((resolve, reject) => {
      pythonProcess.on('error', reject);
      pythonProcess.on('close', (code) => resolve(code ?? 1));
    });

    if (exitCode !== 0) {
      const msg = error?.trim() || output?.trim() || 'Unknown transcription error';
      throw new Error(`Transcription failed (exit ${exitCode}): ${msg}`);
    }

    let parsed: { transcript: string; segments: any[] };
    try {
      parsed = JSON.parse(output);
    } catch {
      throw new Error(`Failed to parse transcript output: ${output} (Error: ${error})`);
    }

    await prisma.feedVideo.update({
      where: { id: feedVideoId },
      data: {
        transcript: parsed.transcript,
        transcriptJson: parsed.segments as any,
        transcriptSource: 'whisper',
      },
    });

    return parsed;
  } finally {
    if (shouldCleanup && tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

function findYouTubeUrl(feedVideo: { s3Url: string; videoId?: string }): string | null {
  if (isYouTubeUrl(feedVideo.s3Url)) {
    return feedVideo.s3Url;
  }
  if (feedVideo.videoId && /^[a-zA-Z0-9_-]{11}$/.test(feedVideo.videoId)) {
    return `https://www.youtube.com/watch?v=${feedVideo.videoId}`;
  }
  return null;
}
