/**
 * Helpers for building the concatenated ("stitched") transcript of a Composition
 * for AI title/caption/description generation.
 *
 * A Composition is a stitched video — it can include the creator clip plus any
 * number of reference tracks, each with their own per-segment transcript. The
 * post-render output gets transcribed in the background (server-side renders) or
 * not at all (client-side renders), so the final `CompositionOutput.transcript`
 * field is often null or stale at the moment the UI auto-fires the AI metadata
 * generation. Passing an empty transcript to the LLM produces generic, content-
 * disconnected titles + captions — the bug this module fixes.
 *
 * Instead, we concatenate the per-source transcripts we already have on the
 * Composition itself (creator transcript JSON + each track's transcript JSON).
 * That gives the AI the actual spoken content of every clip in the stitch, in
 * source order, so the suggested title/caption reflects what's in the video.
 *
 * Pure / framework-agnostic so it can be unit-tested without React or the DB.
 */

export interface TranscriptSegment {
  text: string;
}

export interface CompositionTrackForTranscript {
  /** Order tracks were added in the stitch. Lower = earlier in playback. */
  sortOrder?: number | null;
  /** Whole-clip transcript segments produced by the transcription worker. */
  transcriptJson?: TranscriptSegment[] | null;
}

export interface CompositionForTranscript {
  /** Transcript of the creator's clip (legacy single-track shape). */
  creatorTranscriptJson?: TranscriptSegment[] | null;
  /** All non-creator tracks attached to the composition. */
  tracks?: CompositionTrackForTranscript[] | null;
}

/**
 * Flatten an array of `{ text }` segments into a single string of joined words.
 * Trims each segment and drops empty ones so we don't produce double spaces.
 */
export function flattenTranscriptSegments(
  segments: TranscriptSegment[] | null | undefined
): string {
  // Defensive: the transcription worker can write malformed JSON to the DB
  // (e.g. a partial Whisper response stored as a string, segments missing
  // `text`, non-object entries). The helper's contract is "treat malformed
  // input as no transcript" — never throw, since this runs in the LLM-prompt
  // assembly hot path and a throw kills AI Suggest for every clip in the stitch.
  if (!Array.isArray(segments) || segments.length === 0) return '';
  return segments
    .map((s) => {
      const text = s != null && typeof s === 'object' ? (s as TranscriptSegment).text : undefined;
      return typeof text === 'string' ? text.trim() : '';
    })
    .filter((t) => t.length > 0)
    .join(' ')
    .trim();
}

/**
 * Build the full stitched-video transcript for an AI prompt. Returns `undefined`
 * if no source has a transcript yet — callers pass `undefined` so the prompt
 * omits the transcript block entirely instead of sending an empty string.
 *
 * Order: creator transcript first (it's the spine of the stitch), then each
 * reference track in `sortOrder` ascending. Sources are joined with a blank
 * line so the LLM sees them as distinct passages.
 *
 * @param composition The composition + tracks (only transcript fields needed)
 * @param fallback Optional pre-built transcript to prefer when truthy — used
 *   to honor the rendered-output transcript (which captures the actual stitched
 *   audio) when it has finished being computed.
 */
export function buildStitchedTranscript(
  composition: CompositionForTranscript | null | undefined,
  fallback?: string | null
): string | undefined {
  // Prefer a real rendered-output transcript when one is available.
  const fallbackTrimmed = (fallback ?? '').trim();
  if (fallbackTrimmed.length > 0) return fallbackTrimmed;

  if (!composition) return undefined;

  const parts: string[] = [];

  const creator = flattenTranscriptSegments(composition.creatorTranscriptJson);
  if (creator.length > 0) parts.push(creator);

  const tracks = (composition.tracks ?? [])
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  for (const track of tracks) {
    const segText = flattenTranscriptSegments(track.transcriptJson);
    if (segText.length > 0) parts.push(segText);
  }

  if (parts.length === 0) return undefined;
  return parts.join('\n\n');
}
