/**
 * Instagram media / caption resolver.
 *
 * DESIGN NOTE (do not "improve" this into a 4-layer fallback stack):
 *
 * A prior scouting spike confirmed Instagram exposes ZERO native transcripts
 * publicly or privately:
 *   - Meta's Graph API has no transcript field on video media
 *   - All anonymous scrape paths were killed in the June 2026 doc_id migration
 *   - Every third-party IG transcript product is Whisper-on-audio underneath
 *
 * So the design here is exactly:
 *   1. Log in via `instagram-private-api` with a persisted session state
 *      (produced by `scripts/generate-ig-state.ts`)
 *   2. Convert shortcode -> mediaId (community-standard base64 -> int64)
 *   3. Call `ig.media.info(mediaId)` and return the highest-quality mp4 URL +
 *      the author-written post caption (NOT the transcript)
 *   4. Upstream feeds the mp4 URL into the existing Whisper worker at
 *      `workers/transcription-worker/transcription.ts` — this module does NOT
 *      run Whisper. Set the resulting `source` to `'whisper-instagram'`.
 *
 * The `postCaption` field is honestly named: it's the author-written post
 * text, which is NOT the same thing as spoken-word transcript. Do not
 * concatenate or conflate them anywhere in the UI.
 */

import fs from 'fs';
import path from 'path';

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * Result shape after Whisper has run against the resolved mp4 URL.
 * Mirrors the return shape of `CaptionResult` from `youtube-captions.ts` for
 * consistency, but the source is explicitly `whisper-instagram` — never claim
 * `instagram-native`, that surface does not exist.
 */
export interface InstagramCaptionResult {
  transcript: string;
  segments: TranscriptSegment[];
  source: 'whisper-instagram';
  /** Author-written post caption. NOT the transcript. */
  postCaption?: string;
  mediaId: string;
  shortcode: string;
}

/**
 * Return shape of `resolveInstagramMediaUrl`. Whisper is applied downstream
 * in the transcription worker.
 */
export interface InstagramMediaResolution {
  mp4Url: string;
  postCaption?: string;
  mediaId: string;
  shortcode: string;
}

/**
 * Thrown when the persisted IG session state file is missing or invalid.
 * Upstream API routes should catch this and surface an actionable
 * HTTP 503 "Instagram integration not configured" — do NOT silently fall back.
 */
export class InstagramSessionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstagramSessionUnavailableError';
  }
}

const INSTAGRAM_URL_HOSTS = /(?:^|\.)instagram\.com$/i;

/**
 * Cheap detector — matches URLs on instagram.com pointing at a video-bearing path.
 */
export function isInstagramUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!INSTAGRAM_URL_HOSTS.test(u.hostname)) return false;
    return /\/(reel|reels|p|tv)\//i.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Extract the shortcode from any of the known IG video URL shapes:
 *   - https://www.instagram.com/reel/<shortcode>/
 *   - https://www.instagram.com/reels/<shortcode>/
 *   - https://www.instagram.com/p/<shortcode>/
 *   - https://www.instagram.com/tv/<shortcode>/
 * Returns null if the URL is not a recognized IG media URL.
 */
export function parseInstagramUrl(url: string): { shortcode: string } | null {
  try {
    const u = new URL(url);
    if (!INSTAGRAM_URL_HOSTS.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)\/?/i);
    if (!m) return null;
    return { shortcode: m[1] };
  } catch {
    return null;
  }
}

/**
 * Convert an Instagram shortcode into the numeric media ID that the private
 * API's `media.info(mediaId)` requires.
 *
 * Instagram's shortcodes are base64 (URL-safe: `-` and `_`) representations of
 * a 64-bit integer. This is the community-standard conversion — instagram
 * itself uses the same alphabet.
 */
export function shortcodeToMediaId(shortcode: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const SIXTY_FOUR = BigInt(64);
  let id = BigInt(0);
  for (const ch of shortcode) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) {
      throw new Error(`Invalid Instagram shortcode character: ${ch}`);
    }
    id = id * SIXTY_FOUR + BigInt(idx);
  }
  return id.toString();
}

function resolveSessionStatePath(): string {
  const envPath = process.env.INSTAGRAM_SESSION_STATE_PATH;
  if (envPath && envPath.trim()) return envPath;
  // Default: repo-root filename produced by scripts/generate-ig-state.ts
  return path.resolve(process.cwd(), 'ig-state-source.json');
}

let cachedClient: unknown = null;
let cachedClientState: string | null = null;

/**
 * Lazily load `instagram-private-api` (requires the persisted session state).
 * The client is cached in-process so a burst of requests reuses one login.
 * Throws `InstagramSessionUnavailableError` when the state file is missing
 * or malformed — upstream should map that to HTTP 503.
 */
async function getInstagramClient(): Promise<any> {
  const statePath = resolveSessionStatePath();

  if (!fs.existsSync(statePath)) {
    throw new InstagramSessionUnavailableError(
      `Instagram session state file not found at ${statePath}. ` +
        `Run "npx ts-node scripts/generate-ig-state.ts" to produce it, or set ` +
        `INSTAGRAM_SESSION_STATE_PATH to point at an existing state file.`
    );
  }

  let raw: string;
  try {
    raw = fs.readFileSync(statePath, 'utf-8');
  } catch (err) {
    throw new InstagramSessionUnavailableError(
      `Failed to read Instagram session state at ${statePath}: ${(err as Error).message}`
    );
  }

  // Reuse the cached client if the state file hasn't changed.
  if (cachedClient && cachedClientState === raw) {
    return cachedClient;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new InstagramSessionUnavailableError(
      `Instagram session state at ${statePath} is not valid JSON: ${(err as Error).message}`
    );
  }

  // Dynamic import so the private-api dep doesn't get pulled into edge/browser
  // bundles that never touch Instagram.
  const { IgApiClient } = await import('instagram-private-api');
  const ig = new IgApiClient();
  try {
    await ig.state.deserialize(parsed);
  } catch (err) {
    throw new InstagramSessionUnavailableError(
      `Failed to deserialize Instagram session state: ${(err as Error).message}`
    );
  }

  cachedClient = ig;
  cachedClientState = raw;
  return ig;
}

/**
 * Resolve an Instagram video URL into its signed CDN mp4 URL + author-written
 * caption. Does NOT run Whisper — downstream workers do that.
 *
 * The returned `mp4Url` is a short-lived signed Instagram CDN URL. Feed it
 * into the existing Whisper worker (which just `fetch()`es the URL) or hand
 * it to yt-dlp — either works.
 *
 * Throws:
 *   - InstagramSessionUnavailableError when no session state is configured
 *   - generic Error for bad URLs, private media, or unexpected IG responses
 */
export async function resolveInstagramMediaUrl(url: string): Promise<InstagramMediaResolution> {
  const parsed = parseInstagramUrl(url);
  if (!parsed) {
    throw new Error(`Not a recognized Instagram video URL: ${url}`);
  }
  const { shortcode } = parsed;
  const mediaId = shortcodeToMediaId(shortcode);

  const ig = await getInstagramClient();
  const info = await ig.media.info(mediaId);
  const item = info?.items?.[0];
  if (!item) {
    throw new Error(`Instagram media ${shortcode} (${mediaId}) returned no items`);
  }

  // `video_versions` isn't typed on the public d.ts surface, but the field is
  // present on video-bearing items in the wire response.
  const videoVersions: Array<{ url: string; width?: number; height?: number }> =
    item.video_versions ?? [];

  if (videoVersions.length === 0) {
    throw new Error(`Instagram media ${shortcode} has no video versions (not a video post?)`);
  }

  // IG returns video_versions sorted by quality — [0] is the best.
  const mp4Url = videoVersions[0]?.url;
  if (!mp4Url || typeof mp4Url !== 'string') {
    throw new Error(`Instagram media ${shortcode} first video version has no url`);
  }

  const postCaption = typeof item?.caption?.text === 'string' ? item.caption.text : undefined;

  return {
    mp4Url,
    postCaption,
    mediaId,
    shortcode,
  };
}
