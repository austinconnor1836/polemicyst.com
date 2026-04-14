import { describe, expect, it } from 'vitest';
import { parseFredCsv, parseGallupRss, parseCensusReleaseDate } from '../data-drop-automation';

describe('parseFredCsv', () => {
  it('parses dated numeric observations and skips missing points', () => {
    const csv = ['DATE,UNRATE', '2026-01-01,4.2', '2026-02-01,.', '2026-03-01,4.3', ''].join('\n');

    const points = parseFredCsv(csv);

    expect(points).toEqual([
      { date: '2026-01-01', value: 4.2 },
      { date: '2026-03-01', value: 4.3 },
    ]);
  });

  it('returns an empty array when csv is malformed', () => {
    expect(parseFredCsv('DATE_ONLY')).toEqual([]);
    expect(parseFredCsv('')).toEqual([]);
  });
});

describe('parseGallupRss', () => {
  it('parses item blocks with title, description, link, and pubDate', () => {
    const rss = [
      '<rss><channel>',
      '<item>',
      '<title>Record-High 62% Say U.S. Government Has Too Much Power</title>',
      '<description>Views that the federal government has too much power are now slightly higher than in previous years.</description>',
      '<link>https://news.gallup.com/poll/696191/record-high-say-government-power.aspx</link>',
      '<pubDate>Fri, 10 Oct 2025 08:00:00 GMT</pubDate>',
      '</item>',
      '</channel></rss>',
    ].join('');

    const items = parseGallupRss(rss);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      title: 'Record-High 62% Say U.S. Government Has Too Much Power',
      description:
        'Views that the federal government has too much power are now slightly higher than in previous years.',
      link: 'https://news.gallup.com/poll/696191/record-high-say-government-power.aspx',
      pubDate: 'Fri, 10 Oct 2025 08:00:00 GMT',
    });
  });
});

describe('parseCensusReleaseDate', () => {
  it('extracts YYYY-MM-DD date from Census/FRED release strings', () => {
    expect(parseCensusReleaseDate('1984-01-17 08:30:00-05')).toBe('1984-01-17');
    expect(parseCensusReleaseDate('2026-04-16')).toBe('2026-04-16');
  });

  it('falls back to null for unknown formats', () => {
    expect(parseCensusReleaseDate('tomorrow morning')).toBeNull();
  });
});

describe('dataset identifier consistency', () => {
  it('keeps Gallup economy as a supported dataset id', async () => {
    const { getSupportedDataSources } = await import('../data-drop-automation');
    const sources = getSupportedDataSources();
    const ids = sources.map((source) => source.id);
    expect(ids).toContain('gallup_economy');
  });
});
