import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface CaptionResult {
  transcript: string;
  segments: TranscriptSegment[];
  source: 'youtube-manual' | 'youtube-auto';
}

interface Json3Event {
  tStartMs: number;
  dDurationMs?: number;
  aAppend?: number;
  segs?: Array<{ utf8: string; tOffsetMs?: number; acAsrConf?: number }>;
  wWinId?: number;
  id?: number;
  wpWinPosId?: number;
  wsWinStyleId?: number;
}

interface Json3Data {
  events: Json3Event[];
}

export function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com|youtu\.be)/.test(url);
}

/**
 * Extract the YouTube video ID from a URL.
 * Handles youtube.com/watch?v=ID, youtu.be/ID, and youtube.com/embed/ID.
 */
export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?.*v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function parseJson3(data: Json3Data): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  for (const event of data.events) {
    if (!event.segs || event.aAppend) continue;

    const text = event.segs
      .map((s) => s.utf8)
      .join('')
      .replace(/\n/g, ' ')
      .trim();

    if (!text || /^\[.*\]$/.test(text)) continue;

    const startSec = event.tStartMs / 1000;
    const endSec = event.dDurationMs ? (event.tStartMs + event.dDurationMs) / 1000 : startSec + 5;

    segments.push({ start: startSec, end: endSec, text });
  }

  return segments;
}

function runYtDlpSubs(
  videoUrl: string,
  outputTemplate: string,
  useAutoSub: boolean
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve) => {
    const args = [
      '--skip-download',
      '--sub-lang',
      'en',
      '--sub-format',
      'json3',
      '-o',
      outputTemplate,
      ...(useAutoSub ? ['--write-auto-sub'] : ['--write-sub']),
      videoUrl,
    ];

    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.on('data', () => {});
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stderr }));
  });
}

/**
 * Attempt to fetch YouTube captions for a video URL without downloading the video.
 * Tries manual (human-uploaded) subtitles first, then falls back to auto-generated.
 * Returns null if no English captions are available.
 */
export async function fetchYouTubeCaptions(videoUrl: string): Promise<CaptionResult | null> {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) return null;

  const tmpDir = path.join(os.tmpdir(), `yt-captions-${randomUUID()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const outputTemplate = path.join(tmpDir, '%(id)s');

  try {
    // Try manual (human-uploaded) subtitles first — higher quality
    const manualResult = await runYtDlpSubs(videoUrl, outputTemplate, false);
    const manualFile = path.join(tmpDir, `${videoId}.en.json3`);

    if (manualResult.exitCode === 0 && fs.existsSync(manualFile)) {
      const raw = fs.readFileSync(manualFile, 'utf-8');
      const data: Json3Data = JSON.parse(raw);
      const segments = parseJson3(data);
      if (segments.length > 0) {
        const transcript = segments.map((s) => s.text).join(' ');
        console.info(`📝 Found ${segments.length} manual caption segments for ${videoId}`);
        return { transcript, segments, source: 'youtube-manual' };
      }
    }

    // Fall back to auto-generated subtitles
    const autoResult = await runYtDlpSubs(videoUrl, outputTemplate, true);
    const autoFile = path.join(tmpDir, `${videoId}.en.json3`);

    if (autoResult.exitCode === 0 && fs.existsSync(autoFile)) {
      const raw = fs.readFileSync(autoFile, 'utf-8');
      const data: Json3Data = JSON.parse(raw);
      const segments = parseJson3(data);
      if (segments.length > 0) {
        const transcript = segments.map((s) => s.text).join(' ');
        console.info(`📝 Found ${segments.length} auto-caption segments for ${videoId}`);
        return { transcript, segments, source: 'youtube-auto' };
      }
    }

    console.info(`⚠️ No English captions available for ${videoId}`);
    return null;
  } catch (err) {
    console.warn(`⚠️ Failed to fetch YouTube captions: ${err}`);
    return null;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
