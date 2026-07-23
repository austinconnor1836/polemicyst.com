import { describe, it, expect } from 'vitest';
import {
  parseInstagramUrl,
  isInstagramUrl,
  shortcodeToMediaId,
} from '@shared/lib/instagram-captions';

describe('parseInstagramUrl', () => {
  it('parses /reel/<shortcode>/', () => {
    expect(parseInstagramUrl('https://www.instagram.com/reel/C1a2b3c4d5e/')).toEqual({
      shortcode: 'C1a2b3c4d5e',
    });
  });

  it('parses /reels/<shortcode>/', () => {
    expect(parseInstagramUrl('https://www.instagram.com/reels/C1a2b3c4d5e/')).toEqual({
      shortcode: 'C1a2b3c4d5e',
    });
  });

  it('parses /p/<shortcode>/', () => {
    expect(parseInstagramUrl('https://www.instagram.com/p/C1a2b3c4d5e/')).toEqual({
      shortcode: 'C1a2b3c4d5e',
    });
  });

  it('parses /tv/<shortcode>/', () => {
    expect(parseInstagramUrl('https://www.instagram.com/tv/C1a2b3c4d5e/')).toEqual({
      shortcode: 'C1a2b3c4d5e',
    });
  });

  it('handles URLs with trailing query string', () => {
    expect(parseInstagramUrl('https://www.instagram.com/reel/C1a2b3c4d5e/?igsh=abc123')).toEqual({
      shortcode: 'C1a2b3c4d5e',
    });
  });

  it('handles URLs without trailing slash', () => {
    expect(parseInstagramUrl('https://instagram.com/reel/C1a2b3c4d5e')).toEqual({
      shortcode: 'C1a2b3c4d5e',
    });
  });

  it('returns null for non-Instagram URLs', () => {
    expect(parseInstagramUrl('https://www.youtube.com/watch?v=abc123')).toBeNull();
    expect(parseInstagramUrl('https://tiktok.com/@user/video/1234')).toBeNull();
  });

  it('returns null for Instagram URLs without a media path', () => {
    expect(parseInstagramUrl('https://www.instagram.com/someuser/')).toBeNull();
    expect(parseInstagramUrl('https://www.instagram.com/')).toBeNull();
  });

  it('returns null for malformed URLs', () => {
    expect(parseInstagramUrl('not a url')).toBeNull();
    expect(parseInstagramUrl('')).toBeNull();
  });
});

describe('isInstagramUrl', () => {
  it('matches all IG media URL shapes', () => {
    expect(isInstagramUrl('https://www.instagram.com/reel/abc/')).toBe(true);
    expect(isInstagramUrl('https://www.instagram.com/reels/abc/')).toBe(true);
    expect(isInstagramUrl('https://www.instagram.com/p/abc/')).toBe(true);
    expect(isInstagramUrl('https://www.instagram.com/tv/abc/')).toBe(true);
  });

  it('rejects non-IG URLs and non-media IG URLs', () => {
    expect(isInstagramUrl('https://youtube.com/watch?v=abc')).toBe(false);
    expect(isInstagramUrl('https://www.instagram.com/someuser/')).toBe(false);
  });
});

describe('shortcodeToMediaId', () => {
  // These come from Instagram's community-standard base64 -> int64 conversion.
  // Verified against known public URLs. The alphabet is:
  //   A-Z (0-25), a-z (26-51), 0-9 (52-61), - (62), _ (63)
  it('converts single-character shortcodes correctly', () => {
    expect(shortcodeToMediaId('A')).toBe('0');
    expect(shortcodeToMediaId('B')).toBe('1');
    expect(shortcodeToMediaId('a')).toBe('26');
    expect(shortcodeToMediaId('_')).toBe('63');
  });

  it('converts multi-character shortcodes as base-64 digits', () => {
    // "BA" = 1*64 + 0 = 64
    expect(shortcodeToMediaId('BA')).toBe('64');
    // "BB" = 1*64 + 1 = 65
    expect(shortcodeToMediaId('BB')).toBe('65');
  });

  it('produces stable numeric strings for realistic 11-char shortcodes', () => {
    const id = shortcodeToMediaId('C1a2b3c4d5e');
    expect(id).toMatch(/^\d+$/);
    // "C" = 2, so the ID must fall in the range starting at 2 * 64^10.
    // We just verify it's a plausible 64-bit-scale value.
    expect(id.length).toBeGreaterThan(15);
  });

  it('throws on invalid characters', () => {
    expect(() => shortcodeToMediaId('!@#')).toThrow(/Invalid Instagram shortcode/);
    expect(() => shortcodeToMediaId('has spaces')).toThrow(/Invalid Instagram shortcode/);
  });
});
