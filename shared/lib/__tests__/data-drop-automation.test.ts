import { describe, expect, it } from 'vitest';
import { parseFredCsv } from '../data-drop-automation';

describe('parseFredCsv', () => {
  it('parses dated numeric observations and skips missing points', () => {
    const csv = [
      'DATE,UNRATE',
      '2026-01-01,4.2',
      '2026-02-01,.',
      '2026-03-01,4.3',
      '',
    ].join('\n');

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
