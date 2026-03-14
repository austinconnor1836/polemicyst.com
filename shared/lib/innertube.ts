import { TranscriptSegment, CaptionResult } from './youtube-captions';

export interface InnertubePlayerResponse {
  playabilityStatus?: {
    status: string;
    reason?: string;
  };
  videoDetails?: {
    videoId: string;
    title: string;
    lengthSeconds: string;
    channelId: string;
    shortDescription: string;
    thumbnail?: {
      thumbnails: Array<{ url: string; width: number; height: number }>;
    };
  };
  streamingData?: {
    formats?: InnertubeFormat[];
    adaptiveFormats?: InnertubeFormat[];
    expiresInSeconds?: string;
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: InnertubeTrack[];
    };
  };
}

export interface InnertubeFormat {
  itag: number;
  url?: string;
  mimeType: string;
  bitrate?: number;
  width?: number;
  height?: number;
  contentLength?: string;
  quality?: string;
  qualityLabel?: string;
  audioQuality?: string;
  audioSampleRate?: string;
  audioChannels?: number;
}

interface InnertubeTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText?: string };
  vssId?: string;
  isTranslatable?: boolean;
}

interface Json3Event {
  tStartMs: number;
  dDurationMs?: number;
  aAppend?: number;
  segs?: Array<{ utf8: string; tOffsetMs?: number; acAsrConf?: number }>;
}

/**
 * Fetch video info from YouTube's innertube player API.
 *
 * NOTE: OAuth Bearer tokens do NOT work with innertube — Google returns
 * ACCESS_TOKEN_SCOPE_INSUFFICIENT regardless of scopes. Innertube only
 * accepts unauthenticated requests (works from residential IPs, blocked
 * from datacenter IPs) or cookie-based auth.
 *
 * This function is primarily useful when called from a residential IP
 * (e.g., the iOS client-side path).
 */
export async function fetchInnertubePlayer(
  videoId: string
): Promise<InnertubePlayerResponse | null> {
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

  const YT_CONSENT_COOKIE =
    'SOCS=CAESEwgDEgk2ODE1NjQ0NjQaAmVuIAEaBgiA_LyaBg';

  try {
    const res = await fetch(
      'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: YT_CONSENT_COOKIE,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!res.ok) {
      console.warn(`[innertube] Player API returned ${res.status}`);
      return null;
    }

    return (await res.json()) as InnertubePlayerResponse;
  } catch (err) {
    console.warn(`[innertube] Player request failed: ${err}`);
    return null;
  }
}

/**
 * Fetch captions from innertube (unauthenticated).
 * Works from residential IPs; blocked from datacenter IPs.
 * On the server, this is a best-effort attempt that falls back to yt-dlp/Whisper.
 */
export async function fetchCaptionsViaInnertubeAuth(
  videoId: string,
  _accessToken?: string
): Promise<CaptionResult | null> {
  const playerData = await fetchInnertubePlayer(videoId);
  if (!playerData) return null;

  const status = playerData.playabilityStatus?.status;
  if (status && status !== 'OK') {
    console.warn(
      `[innertube] Playability: ${status} — ${playerData.playabilityStatus?.reason || ''} (checking for captions anyway)`
    );
  }

  // Check for captions regardless of playability — YouTube's WEB client
  // returns UNPLAYABLE for many videos now but may still include captions.
  const tracks = playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || tracks.length === 0) {
    console.warn(`[innertube] No caption tracks for ${videoId} (playability: ${status || 'unknown'})`);
    return null;
  }

  return extractCaptionsFromInnertubeTrack(tracks, videoId);
}

async function extractCaptionsFromInnertubeTrack(
  tracks: InnertubeTrack[],
  videoId: string
): Promise<CaptionResult | null> {
  const manualTrack = tracks.find((t) => t.languageCode === 'en' && t.kind !== 'asr');
  const autoTrack = tracks.find((t) => t.languageCode === 'en' && t.kind === 'asr');
  const enVariant = tracks.find((t) => t.languageCode?.startsWith('en'));

  const track = manualTrack || autoTrack || enVariant;
  if (!track?.baseUrl) {
    console.warn(`[innertube-auth] No English caption track for ${videoId}`);
    return null;
  }

  const source: CaptionResult['source'] =
    track === manualTrack || (track === enVariant && track.kind !== 'asr')
      ? 'youtube-manual'
      : 'youtube-auto';

  const captionUrl = `${track.baseUrl}&fmt=json3`;
  try {
    const res = await fetch(captionUrl);
    if (!res.ok) {
      console.warn(`[innertube-auth] Caption fetch failed: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const segments = parseJson3Events(data.events || []);
    if (segments.length === 0) {
      console.warn(`[innertube-auth] No segments parsed for ${videoId}`);
      return null;
    }

    const transcript = segments.map((s) => s.text).join(' ');
    console.info(
      `📝 Fetched ${segments.length} ${source} caption segments for ${videoId} via innertube (authenticated)`
    );
    return { transcript, segments, source };
  } catch (err) {
    console.warn(`[innertube-auth] Caption data fetch failed: ${err}`);
    return null;
  }
}

function parseJson3Events(events: Json3Event[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  for (const event of events) {
    if (!event.segs || event.aAppend) continue;

    const text = event.segs
      .map((s) => s.utf8)
      .join('')
      .replace(/\n/g, ' ')
      .trim();

    if (!text || /^\[.*\]$/.test(text)) continue;

    const startSec = event.tStartMs / 1000;
    const endSec = event.dDurationMs
      ? (event.tStartMs + event.dDurationMs) / 1000
      : startSec + 5;

    segments.push({ start: startSec, end: endSec, text });
  }

  return segments;
}

/**
 * Get the best streaming URL from innertube player response.
 * Prefers mp4 video with audio in a reasonable quality.
 */
export function getBestStreamingUrl(
  playerData: InnertubePlayerResponse
): string | null {
  const formats = playerData.streamingData?.formats;
  if (!formats || formats.length === 0) return null;

  const mp4 = formats
    .filter((f) => f.url && f.mimeType.startsWith('video/mp4'))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  return mp4[0]?.url || formats[0]?.url || null;
}
