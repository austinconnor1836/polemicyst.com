export type TranscriptWordSegment = {
  start: number; // seconds
  end: number;   // seconds
  text: string;
};

export type ClipCandidate = {
  tStartS: number;
  tEndS: number;
  text: string;
  score: number;
  features: Record<string, any>;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

/**
 * Simple, offline scoring heuristic. Produces a 0..10 score.
 * This is intentionally deterministic so local development doesn't depend on Ollama/LLMs.
 */
export function scoreCandidateHeuristic(text: string): { score: number; features: Record<string, any> } {
  const normalized = text.trim();
  const wordCount = normalized ? normalized.split(/\s+/).length : 0;
  const exclamations = countMatches(text, /!/g);
  const questions = countMatches(text, /\?/g);
  const quotes = countMatches(text, /["”“]/g);
  const allCapsWords = countMatches(text, /\b[A-Z]{3,}\b/g);

  // lightweight "spiciness"/emotion dictionary
  const spicyWords = [
    'insane', 'crazy', 'wild', 'shocking', 'unbelievable', 'secret', 'truth', 'lied', 'exposed',
    'hate', 'love', 'destroy', 'cancel', 'scam', 'fraud', 'controversial', 'problem', 'why',
  ];
  const spicyHits = spicyWords.reduce((acc, w) => acc + countMatches(text.toLowerCase(), new RegExp(`\\b${w}\\b`, 'g')), 0);

  // Prefer ~15-45s worth of words (very rough: 2.5 w/s => 37-112 words)
  const lengthScore =
    wordCount < 25 ? 0.5 :
    wordCount < 60 ? 2.0 :
    wordCount < 140 ? 1.5 :
    0.5;

  let score =
    lengthScore +
    exclamations * 0.6 +
    questions * 0.8 +
    quotes * 0.15 +
    allCapsWords * 0.4 +
    spicyHits * 0.35;

  // penalize very short / empty
  if (wordCount < 8) score -= 2.5;

  score = clamp(score, 0, 10);

  return {
    score,
    features: {
      wordCount,
      exclamations,
      questions,
      quotes,
      allCapsWords,
      spicyHits,
    },
  };
}

/**
 * Build candidate windows by grouping transcript segments into ~windowSeconds windows.
 * The transcriptJson coming from transcription is typically word/phrase segments with start/end.
 */
export function buildCandidatesFromTranscript(
  segments: TranscriptWordSegment[],
  {
    windowSeconds = 28,
    maxWindowSeconds = 55,
  }: { windowSeconds?: number; maxWindowSeconds?: number } = {}
): Array<Omit<ClipCandidate, 'score' | 'features'> & { rawSegments: TranscriptWordSegment[] }> {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const candidates: Array<Omit<ClipCandidate, 'score' | 'features'> & { rawSegments: TranscriptWordSegment[] }> = [];

  let i = 0;
  while (i < sorted.length) {
    const startS = sorted[i].start;
    let endS = sorted[i].end;
    const rawSegments: TranscriptWordSegment[] = [sorted[i]];

    let j = i + 1;
    while (j < sorted.length) {
      const next = sorted[j];
      const nextEnd = next.end;
      const proposedEnd = Math.max(endS, nextEnd);
      const duration = proposedEnd - startS;
      if (duration > maxWindowSeconds) break;
      rawSegments.push(next);
      endS = proposedEnd;
      if (duration >= windowSeconds) break;
      j += 1;
    }

    const text = rawSegments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
    if (text) {
      candidates.push({
        tStartS: startS,
        tEndS: endS,
        text,
        rawSegments,
      });
    }

    // Move forward. We advance by roughly half window to create overlap.
    const targetAdvanceS = startS + Math.max(6, Math.floor(windowSeconds / 2));
    while (i < sorted.length && sorted[i].start < targetAdvanceS) i += 1;
    if (i === j) i += 1; // safety
  }

  return candidates;
}

export function scoreAndRankCandidates(
  candidates: Array<Omit<ClipCandidate, 'score' | 'features'> & { rawSegments?: TranscriptWordSegment[] }>,
  topN: number
): ClipCandidate[] {
  const scored = candidates.map((c) => {
    const scoredPart = scoreCandidateHeuristic(c.text);
    return {
      tStartS: c.tStartS,
      tEndS: c.tEndS,
      text: c.text,
      score: scoredPart.score,
      features: {
        ...scoredPart.features,
        durationS: Math.max(0, c.tEndS - c.tStartS),
      },
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, topN));
}


