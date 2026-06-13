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
});
