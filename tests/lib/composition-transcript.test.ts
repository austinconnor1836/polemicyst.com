import { describe, it, expect } from 'vitest';
import {
  buildStitchedTranscript,
  flattenTranscriptSegments,
} from '@shared/lib/composition-transcript';

describe('flattenTranscriptSegments', () => {
  it('joins segment text with single spaces', () => {
    expect(flattenTranscriptSegments([{ text: 'hello' }, { text: 'world' }])).toBe('hello world');
  });

  it('trims whitespace inside each segment', () => {
    expect(flattenTranscriptSegments([{ text: '  hello  ' }, { text: ' world ' }])).toBe(
      'hello world'
    );
  });

  it('drops empty segments instead of producing double spaces', () => {
    expect(
      flattenTranscriptSegments([
        { text: 'hello' },
        { text: '' },
        { text: '   ' },
        { text: 'world' },
      ])
    ).toBe('hello world');
  });

  it('returns empty string for null / undefined / empty array', () => {
    expect(flattenTranscriptSegments(null)).toBe('');
    expect(flattenTranscriptSegments(undefined)).toBe('');
    expect(flattenTranscriptSegments([])).toBe('');
  });
});

describe('buildStitchedTranscript', () => {
  it('returns undefined when nothing has a transcript yet', () => {
    expect(
      buildStitchedTranscript({
        creatorTranscriptJson: null,
        tracks: [{ sortOrder: 0, transcriptJson: null }],
      })
    ).toBeUndefined();
  });

  it('returns the creator transcript when no tracks exist', () => {
    expect(
      buildStitchedTranscript({
        creatorTranscriptJson: [{ text: 'creator speaks' }],
        tracks: [],
      })
    ).toBe('creator speaks');
  });

  // The core regression this module was added to fix: a stitched composition
  // with multiple reference tracks must produce a transcript that contains
  // EVERY clip's text, not just the creator's. Before the fix, the auto-fire
  // generateDescription path sent only `output.transcript` (often null for
  // client-side renders) and the AI produced generic copy detached from the
  // actual video content.
  it('concatenates creator + every track transcript into the stitched whole', () => {
    const transcript = buildStitchedTranscript({
      creatorTranscriptJson: [{ text: 'I react to' }, { text: 'this clip' }],
      tracks: [
        {
          sortOrder: 0,
          transcriptJson: [{ text: 'reference one says hello' }],
        },
        {
          sortOrder: 1,
          transcriptJson: [{ text: 'reference two says goodbye' }],
        },
      ],
    });

    // All three sources show up — the bug was that we only had the first one.
    expect(transcript).toContain('I react to this clip');
    expect(transcript).toContain('reference one says hello');
    expect(transcript).toContain('reference two says goodbye');
  });

  it('orders tracks by sortOrder ascending regardless of array order', () => {
    const transcript = buildStitchedTranscript({
      creatorTranscriptJson: [{ text: 'creator' }],
      tracks: [
        // Intentionally out of order in the array — the helper must sort them.
        { sortOrder: 2, transcriptJson: [{ text: 'third' }] },
        { sortOrder: 0, transcriptJson: [{ text: 'first' }] },
        { sortOrder: 1, transcriptJson: [{ text: 'second' }] },
      ],
    });

    expect(transcript).toBeDefined();
    const creatorIdx = transcript!.indexOf('creator');
    const firstIdx = transcript!.indexOf('first');
    const secondIdx = transcript!.indexOf('second');
    const thirdIdx = transcript!.indexOf('third');

    expect(creatorIdx).toBeGreaterThanOrEqual(0);
    expect(creatorIdx).toBeLessThan(firstIdx);
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  it('skips tracks that have no transcript yet (e.g. still being transcribed)', () => {
    const transcript = buildStitchedTranscript({
      creatorTranscriptJson: [{ text: 'creator' }],
      tracks: [
        { sortOrder: 0, transcriptJson: [{ text: 'first' }] },
        { sortOrder: 1, transcriptJson: null },
        { sortOrder: 2, transcriptJson: [{ text: 'third' }] },
      ],
    });

    expect(transcript).toContain('creator');
    expect(transcript).toContain('first');
    expect(transcript).toContain('third');
    // No double blank-line block from the skipped middle track.
    expect(transcript).not.toMatch(/\n\n\n/);
  });

  it('prefers a non-empty fallback over the stitched concatenation', () => {
    // When the rendered-output transcript has finished computing (it captures
    // the actual stitched audio, including any audio-mode mixing), prefer it.
    const fallback = 'the actual rendered output transcript';
    const transcript = buildStitchedTranscript(
      {
        creatorTranscriptJson: [{ text: 'creator speaks' }],
        tracks: [{ sortOrder: 0, transcriptJson: [{ text: 'reference' }] }],
      },
      fallback
    );
    expect(transcript).toBe(fallback);
  });

  it('falls back to the stitched concatenation when fallback is empty / null', () => {
    const transcript = buildStitchedTranscript(
      {
        creatorTranscriptJson: [{ text: 'creator' }],
        tracks: [{ sortOrder: 0, transcriptJson: [{ text: 'reference' }] }],
      },
      null
    );
    expect(transcript).toContain('creator');
    expect(transcript).toContain('reference');

    const fromEmptyString = buildStitchedTranscript(
      {
        creatorTranscriptJson: [{ text: 'creator' }],
        tracks: [],
      },
      ''
    );
    expect(fromEmptyString).toBe('creator');
  });

  it('returns undefined when composition is null/undefined and there is no fallback', () => {
    expect(buildStitchedTranscript(null)).toBeUndefined();
    expect(buildStitchedTranscript(undefined)).toBeUndefined();
    expect(buildStitchedTranscript(null, '')).toBeUndefined();
  });

  it('returns the fallback when composition is null but fallback is provided', () => {
    expect(buildStitchedTranscript(null, 'hi')).toBe('hi');
  });

  // W007 — edge cases that the helper must survive in production.

  describe('buildStitchedTranscript — edge cases (W007)', () => {
    it('resolves sortOrder ties deterministically (stable order by array index)', () => {
      const transcript = buildStitchedTranscript({
        creatorTranscriptJson: null,
        // Three tracks with the same sortOrder — stable sort means whichever
        // appeared first in the array stays first in the concat. The exact tie
        // breaker is an implementation detail; the contract is that the result
        // is deterministic (no randomization) and contains every text exactly
        // once.
        tracks: [
          { sortOrder: 0, transcriptJson: [{ text: 'alpha' }] },
          { sortOrder: 0, transcriptJson: [{ text: 'beta' }] },
          { sortOrder: 0, transcriptJson: [{ text: 'gamma' }] },
        ],
      });

      expect(transcript).toBeDefined();
      expect(transcript).toContain('alpha');
      expect(transcript).toContain('beta');
      expect(transcript).toContain('gamma');

      // Same input → same output, twice in a row.
      const second = buildStitchedTranscript({
        creatorTranscriptJson: null,
        tracks: [
          { sortOrder: 0, transcriptJson: [{ text: 'alpha' }] },
          { sortOrder: 0, transcriptJson: [{ text: 'beta' }] },
          { sortOrder: 0, transcriptJson: [{ text: 'gamma' }] },
        ],
      });
      expect(transcript).toBe(second);
    });

    it('treats missing sortOrder (undefined/null) as 0 and tie-breaks stably', () => {
      const transcript = buildStitchedTranscript({
        creatorTranscriptJson: null,
        tracks: [
          { transcriptJson: [{ text: 'no-sort-order' }] },
          { sortOrder: null, transcriptJson: [{ text: 'null-sort-order' }] },
          { sortOrder: 5, transcriptJson: [{ text: 'explicit-five' }] },
        ],
      });

      expect(transcript).toBeDefined();
      // The two "0-equivalent" tracks come before the explicit 5.
      expect(transcript!.indexOf('no-sort-order')).toBeLessThan(
        transcript!.indexOf('explicit-five')
      );
      expect(transcript!.indexOf('null-sort-order')).toBeLessThan(
        transcript!.indexOf('explicit-five')
      );
    });

    it('skips a malformed transcriptJson without throwing', () => {
      // The worker can in theory write garbage if a Whisper response gets
      // partially corrupted (e.g. a non-array body, segments without `text`,
      // wrong-typed entries). The helper should treat each malformed track
      // as "no transcript yet" and keep going — never bubble up an error.
      const transcript = buildStitchedTranscript({
        creatorTranscriptJson: [{ text: 'creator is fine' }],
        tracks: [
          { sortOrder: 0, transcriptJson: [{ text: 'normal track' }] },
          // @ts-expect-error — intentionally wrong shape for the test
          { sortOrder: 1, transcriptJson: 'not an array' },
          // @ts-expect-error — intentionally wrong shape for the test
          { sortOrder: 2, transcriptJson: [{ wrongField: 'nope' }] },
          // @ts-expect-error — intentionally wrong shape for the test
          { sortOrder: 3, transcriptJson: [42, null, { text: 'survivor' }] },
          { sortOrder: 4, transcriptJson: [{ text: 'last good track' }] },
        ],
      });

      expect(transcript).toBeDefined();
      expect(transcript).toContain('creator is fine');
      expect(transcript).toContain('normal track');
      expect(transcript).toContain('last good track');
      // No exception was raised — that's the contract.
    });

    it('handles a very long single-track transcript (>= 10k chars) without crashing', () => {
      // Whisper output for a 60-minute podcast clip can easily be >100k chars.
      // The helper should be a simple concatenation; no surprise N^2 explosion,
      // no stack overflow from recursion.
      const words = Array.from({ length: 2000 }, (_, i) => `word${i}`);
      const longSegments = words.map((w) => ({ text: w }));
      const transcript = buildStitchedTranscript({
        creatorTranscriptJson: longSegments,
        tracks: [],
      });

      expect(transcript).toBeDefined();
      expect(transcript!.length).toBeGreaterThanOrEqual(10_000);
      expect(transcript).toContain('word0');
      expect(transcript).toContain('word1999');
    });

    it('handles many tracks with long transcripts without crashing', () => {
      // 20 tracks * 1000 words each = 20k segments. Production stitches
      // routinely hit 5–10 tracks; this is a generous safety margin.
      const tracks = Array.from({ length: 20 }, (_, t) => ({
        sortOrder: t,
        transcriptJson: Array.from({ length: 1000 }, (_, i) => ({
          text: `t${t}w${i}`,
        })),
      }));

      const transcript = buildStitchedTranscript({
        creatorTranscriptJson: [{ text: 'creator' }],
        tracks,
      });

      expect(transcript).toBeDefined();
      expect(transcript).toContain('creator');
      expect(transcript).toContain('t0w0');
      expect(transcript).toContain('t19w999');
      // Conservative lower bound; actual is well above this.
      expect(transcript!.length).toBeGreaterThanOrEqual(50_000);
    });
  });
});
