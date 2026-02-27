export type ContentStyle =
  | 'politics'
  | 'comedy'
  | 'education'
  | 'podcast'
  | 'gaming'
  | 'vlog'
  | 'other';

export type ContentStyleDetection = {
  style: ContentStyle;
  confidence: number; // 0..1
  signals: string[];
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function countAny(text: string, words: string[]): number {
  let hits = 0;
  for (const w of words) {
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'gi');
    const m = text.match(re);
    if (m) hits += m.length;
  }
  return hits;
}

/**
 * Lightweight transcript-based style detection.
 * This is intentionally simple + cheap; it’s only used to pick scoring defaults and prompt tuning.
 */
export function detectContentStyle(params: {
  transcriptText: string;
  title?: string | null;
}): ContentStyleDetection {
  const combined = `${params.title ?? ''}\n${params.transcriptText ?? ''}`.toLowerCase();

  const politics = countAny(combined, [
    'election',
    'vote',
    'voter',
    'ballot',
    'democrat',
    'republican',
    'congress',
    'senate',
    'house',
    'supreme',
    'court',
    'judge',
    'bill',
    'law',
    'constitution',
    'white house',
    'president',
    'biden',
    'trump',
    'ukraine',
    'israel',
    'gaza',
    'border',
    'immigration',
    'tax',
    'inflation',
    'corrupt',
    'scandal',
    'breaking',
    'cnn',
    'fox',
  ]);
  const comedy = countAny(combined, [
    'funny',
    'hilarious',
    'joke',
    'standup',
    'comedian',
    'lol',
    'roast',
    'skit',
  ]);
  const education = countAny(combined, [
    'how to',
    'explain',
    'explained',
    'tutorial',
    'lesson',
    'here’s why',
    'step',
    'guide',
  ]);
  const podcast = countAny(combined, [
    'podcast',
    'episode',
    'host',
    'guest',
    'subscribe',
    'today we',
    'welcome to',
  ]);
  const gaming = countAny(combined, [
    'gameplay',
    'level',
    'boss',
    'ranked',
    'fps',
    'fortnite',
    'minecraft',
    'call of duty',
    'valorant',
  ]);
  const vlog = countAny(combined, [
    'vlog',
    'day in the life',
    'travel',
    'morning routine',
    'today i',
    'we went',
  ]);

  const scores: Array<{ style: ContentStyle; score: number; signals: string[] }> = [
    { style: 'politics', score: politics, signals: politics ? ['politics_keywords'] : [] },
    { style: 'comedy', score: comedy, signals: comedy ? ['comedy_keywords'] : [] },
    { style: 'education', score: education, signals: education ? ['education_keywords'] : [] },
    { style: 'podcast', score: podcast, signals: podcast ? ['podcast_keywords'] : [] },
    { style: 'gaming', score: gaming, signals: gaming ? ['gaming_keywords'] : [] },
    { style: 'vlog', score: vlog, signals: vlog ? ['vlog_keywords'] : [] },
  ];

  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  const runnerUp = scores[1];
  const topScore = top?.score ?? 0;
  const runnerScore = runnerUp?.score ?? 0;

  if (!topScore) {
    return { style: 'other', confidence: 0.3, signals: ['no_keywords'] };
  }

  // Confidence: higher when top is large and separated from runner up.
  const confidence = clamp(
    0.35 + Math.min(0.5, topScore / 20) + Math.min(0.25, (topScore - runnerScore) / 10),
    0,
    1
  );
  return { style: top.style, confidence, signals: top.signals };
}
