import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

// Re-export authenticated innertube for convenience
export { fetchCaptionsViaInnertubeAuth } from './innertube';

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

// YouTube consent cookie — auto-accepts the EU consent page.
// Without this, server-side requests get a consent wall instead of video data.
// This is the same technique used by youtube-transcript-api.
const YT_CONSENT_COOKIE = 'SOCS=CAESEwgDEgk2ODE1NjQ0NjQaAmVuIAEaBgiA_LyaBg';

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
      '--js-runtimes',
      'node',
      '--add-header',
      `Cookie:${YT_CONSENT_COOKIE}`,
      '-o',
      outputTemplate,
      ...(useAutoSub ? ['--write-auto-sub'] : ['--write-sub']),
      videoUrl,
    ];

    console.info(`[yt-dlp] Running: yt-dlp ${args.join(' ')}`);
    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (code !== 0) {
        console.warn(`[yt-dlp] Exit code ${code}, stderr: ${stderr.trim()}`);
      } else if (stdout) {
        console.info(`[yt-dlp] stdout: ${stdout.trim()}`);
      }
      resolve({ exitCode: code ?? 1, stderr });
    });
  });
}

/**
 * Fetch YouTube captions via pure HTTP (no yt-dlp required).
 * When an accessToken is provided, tries authenticated innertube first (most reliable).
 * Falls back to youtube-transcript-api, unauthenticated innertube, and watch page scraping.
 */
export async function fetchYouTubeCaptionsHTTP(
  videoUrl: string,
  accessToken?: string
): Promise<CaptionResult | null> {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) return null;

  // If we have a Google OAuth token, try authenticated innertube first (bypasses bot detection)
  if (accessToken) {
    const { fetchCaptionsViaInnertubeAuth } = await import('./innertube');
    const authResult = await fetchCaptionsViaInnertubeAuth(videoId, accessToken);
    if (authResult) return authResult;
    console.warn('[captions-http] Authenticated innertube failed, trying fallbacks...');
  }

  // Try youtube-transcript-api Python library (most reliable unauthenticated method)
  const pytResult = await fetchCaptionsViaPython(videoId);
  if (pytResult) return pytResult;

  // Try unauthenticated innertube API
  const innertubeResult = await fetchCaptionsViaInnertube(videoId);
  if (innertubeResult) return innertubeResult;

  // Fall back to watch page scraping
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: YT_CONSENT_COOKIE,
      },
    });
    if (!res.ok) {
      console.warn(`[captions-http] Watch page fetch failed: ${res.status}`);
      return null;
    }

    const html = await res.text();

    const playerMatch = html.match(
      /ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});(?:\s*var\s|<\/script>)/
    );
    if (!playerMatch) {
      console.warn('[captions-http] No ytInitialPlayerResponse found in page');
      return null;
    }

    let playerResponse: any;
    try {
      playerResponse = JSON.parse(playerMatch[1]);
    } catch {
      console.warn('[captions-http] Failed to parse player response JSON');
      return null;
    }

    const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
      console.warn(`[captions-http] No caption tracks found for ${videoId}`);
      return null;
    }

    return extractCaptionsFromTracks(captionTracks, videoId, 'HTTP');
  } catch (err) {
    console.warn(`⚠️ HTTP YouTube captions fetch failed: ${err}`);
    return null;
  }
}

/**
 * Fetch captions via the youtube-transcript-api Python library.
 * This library is specifically maintained to handle YouTube's anti-bot measures.
 */
function fetchCaptionsViaPython(videoId: string): Promise<CaptionResult | null> {
  return new Promise((resolve) => {
    // In Docker standalone, the script is at /app/scripts/; in dev, it's relative to repo root
    const scriptPath = fs.existsSync('/app/scripts/fetch-yt-captions.py')
      ? '/app/scripts/fetch-yt-captions.py'
      : path.resolve(process.cwd(), 'scripts/fetch-yt-captions.py');
    const child = spawn('python3', [scriptPath, videoId], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (code !== 0) {
        console.warn(`[captions-python] Exit code ${code}: ${stderr.trim()}`);
        resolve(null);
        return;
      }
      try {
        const data = JSON.parse(stdout);
        const segments: TranscriptSegment[] = data.segments;
        const source: CaptionResult['source'] = data.source;
        if (!segments || segments.length === 0) {
          console.warn('[captions-python] No segments returned');
          resolve(null);
          return;
        }
        const transcript = segments.map((s) => s.text).join(' ');
        console.info(
          `📝 Fetched ${segments.length} ${source} caption segments for ${videoId} via youtube-transcript-api`
        );
        resolve({ transcript, segments, source });
      } catch (err) {
        console.warn(`[captions-python] Failed to parse output: ${err}`);
        resolve(null);
      }
    });
    child.on('error', (err) => {
      console.warn(`[captions-python] Spawn error: ${err.message}`);
      resolve(null);
    });
  });
}

/**
 * Fetch captions via YouTube's innertube API (player endpoint).
 * Sends YouTube consent cookie and tries the WEB client.
 */
async function fetchCaptionsViaInnertube(videoId: string): Promise<CaptionResult | null> {
  const payload = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20240313.05.00',
        hl: 'en',
        gl: 'US',
      },
    },
    videoId,
  };

  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: YT_CONSENT_COOKIE,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.warn(`[captions-innertube] Player API returned ${res.status}`);
      return null;
    }

    const data = await res.json();

    const playabilityStatus = data?.playabilityStatus?.status;
    if (playabilityStatus && playabilityStatus !== 'OK') {
      console.warn(
        `[captions-innertube] Playability: ${playabilityStatus} - ${data?.playabilityStatus?.reason || ''}`
      );
      return null;
    }

    const captionTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
      console.warn(`[captions-innertube] No caption tracks for ${videoId}`);
      return null;
    }

    return extractCaptionsFromTracks(captionTracks, videoId, 'innertube');
  } catch (err) {
    console.warn(`[captions-innertube] Failed: ${err}`);
    return null;
  }
}

/**
 * Given an array of YouTube caption tracks, find the best English track
 * and fetch + parse the captions.
 */
async function extractCaptionsFromTracks(
  captionTracks: any[],
  videoId: string,
  method: string
): Promise<CaptionResult | null> {
  const manualTrack = captionTracks.find((t: any) => t.languageCode === 'en' && t.kind !== 'asr');
  const autoTrack = captionTracks.find((t: any) => t.languageCode === 'en' && t.kind === 'asr');
  const enVariantTrack = captionTracks.find((t: any) => t.languageCode?.startsWith('en'));

  const track = manualTrack || autoTrack || enVariantTrack;
  if (!track?.baseUrl) {
    console.warn(`[captions-${method}] No English track found for ${videoId}`);
    return null;
  }

  const source: CaptionResult['source'] =
    track === manualTrack || (track === enVariantTrack && track.kind !== 'asr')
      ? 'youtube-manual'
      : 'youtube-auto';

  const captionUrl = `${track.baseUrl}&fmt=json3`;
  const captionRes = await fetch(captionUrl);
  if (!captionRes.ok) {
    console.warn(`[captions-${method}] Caption fetch failed: ${captionRes.status}`);
    return null;
  }

  const data: Json3Data = await captionRes.json();
  const segments = parseJson3(data);
  if (segments.length === 0) {
    console.warn(`[captions-${method}] No segments parsed for ${videoId}`);
    return null;
  }

  const transcript = segments.map((s) => s.text).join(' ');
  console.info(
    `📝 Fetched ${segments.length} ${source} caption segments for ${videoId} via ${method}`
  );
  return { transcript, segments, source };
}

/**
 * Attempt to fetch YouTube captions for a video URL without downloading the video.
 * Uses yt-dlp CLI — requires yt-dlp to be installed (use in workers only).
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
