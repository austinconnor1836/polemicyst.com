/**
 * Transcript search helpers.
 *
 * Inspired by the standalone Python CLI at
 * ~/Developer/search-text-in-videos/search_text_in_videos.py. Same query
 * semantics — case-insensitive, treat the input as a regex if it compiles,
 * otherwise fall back to escaped substring, optionally wrap in \b(?:...)\b
 * for whole-word matching (the CLI's `-w` flag).
 *
 * Pure / framework-agnostic so the route handler can unit-test it.
 */

/** Segment shape emitted by our transcription pipeline (Whisper/YouTube). */
export interface TranscriptSegment {
  start?: number;
  end?: number;
  text?: string;
}

export interface CompiledQuery {
  regex: RegExp;
  /** True when the user's raw input compiled as regex; false = fell back to escaped substring. */
  isRegex: boolean;
  wordBoundary: boolean;
}

export interface TranscriptHit {
  startSec: number;
  endSec: number | null;
  matchText: string;
  matchedSpan: string;
}

/**
 * Compile a query into a case-insensitive RegExp. Mirrors the Python CLI's
 * `compile_query` — tries the raw input first, escapes on regex-syntax error.
 * When `wordBoundary` is true, wraps in `\b(?:...)\b` (grep -w semantics).
 */
export function compileQuery(input: string, wordBoundary = false): CompiledQuery {
  const wrap = (pat: string) => (wordBoundary ? `\\b(?:${pat})\\b` : pat);
  try {
    return {
      regex: new RegExp(wrap(input), 'i'),
      isRegex: true,
      wordBoundary,
    };
  } catch {
    return {
      regex: new RegExp(wrap(escapeRegex(input)), 'i'),
      isRegex: false,
      wordBoundary,
    };
  }
}

/**
 * Escape a string so it can be safely embedded in a regex as a literal.
 * Matches Python's `re.escape` for the characters that matter here.
 */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scan a transcript's segments for matches, returning one TranscriptHit per
 * matching segment. Non-string / empty segments are skipped.
 */
export function scanTranscript(segments: unknown, compiled: CompiledQuery): TranscriptHit[] {
  if (!Array.isArray(segments)) return [];
  const hits: TranscriptHit[] = [];
  for (const raw of segments) {
    if (!raw || typeof raw !== 'object') continue;
    const seg = raw as TranscriptSegment;
    const text = typeof seg.text === 'string' ? seg.text.trim() : '';
    if (!text) continue;
    const m = compiled.regex.exec(text);
    if (!m) continue;
    const start = typeof seg.start === 'number' ? seg.start : 0;
    const end = typeof seg.end === 'number' ? seg.end : null;
    hits.push({
      startSec: start,
      endSec: end,
      matchText: text,
      matchedSpan: m[0],
    });
  }
  return hits;
}

/**
 * Deep-link into YouTube at a given second offset. Matches the Python CLI's
 * `emit_hit` format (`https://youtu.be/<id>?t=<start_int>`).
 */
export function youtubeDeepLink(videoId: string, startSec: number): string {
  return `https://youtu.be/${videoId}?t=${Math.floor(startSec)}`;
}

/** hh:mm:ss timestamp — drops the hours slot when it's zero, like the CLI. */
export function formatTimestamp(sec: number): string {
  const s = Math.floor(Math.max(0, sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}
