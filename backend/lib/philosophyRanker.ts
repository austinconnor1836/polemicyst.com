import type { ClipCandidate } from './viral-scoring';

const DUTY_KEYWORDS = [
  'duty',
  'moral',
  'categorical imperative',
  'imperative',
  'obligation',
  'universal law',
  'maxim',
  'ought',
  'ought to',
  'must',
  'reason',
  'rational',
  'autonomy',
  'ends',
  'means',
  'moral law',
];

const LOGIC_CONNECTORS = ['therefore', 'thus', 'hence', 'consequently', 'because', 'if', 'then'];

export type PhilosophyRankerInput = {
  transcript: string;
  candidate: Pick<ClipCandidate, 'tStartS' | 'tEndS' | 'text'>;
};

export type PhilosophyRankerScore = {
  score: number; // 0-10
  normalizedScore: number; // 0-1
  evidence: {
    dutyHits: string[];
    connectorHits: string[];
    argumentStructures: number;
  };
};

function countOccurrences(text: string, keywords: string[]) {
  const hits: string[] = [];
  const lower = text.toLowerCase();
  keywords.forEach((key) => {
    if (lower.includes(key)) {
      hits.push(key);
    }
  });
  return hits;
}

function estimateArgumentStructures(text: string) {
  const normalized = text.toLowerCase();
  let count = 0;
  if (normalized.includes('if') && normalized.includes('then')) count += 1;
  if (normalized.includes('because')) count += 1;
  if (normalized.includes('therefore') || normalized.includes('thus')) count += 1;
  return count;
}

export function scorePhilosophicalRhetoric(input: PhilosophyRankerInput): PhilosophyRankerScore {
  const { transcript } = input;
  const words = transcript.trim().split(/\s+/);
  const wordCount = Math.max(words.length, 1);
  const dutyHits = countOccurrences(transcript, DUTY_KEYWORDS);
  const connectorHits = countOccurrences(transcript, LOGIC_CONNECTORS);
  const argumentStructures = estimateArgumentStructures(transcript);

  const dutyRatio = dutyHits.length / wordCount;
  const connectorRatio = connectorHits.length / wordCount;

  // Basic heuristic: emphasize segments with moral vocabulary and logical connectors.
  let rawScore =
    dutyHits.length * 2 +
    connectorHits.length * 1.5 +
    argumentStructures * 2 +
    dutyRatio * 100 +
    connectorRatio * 60;

  rawScore = Math.min(rawScore, 10);
  const normalizedScore = rawScore / 10;

  return {
    score: rawScore,
    normalizedScore,
    evidence: {
      dutyHits,
      connectorHits,
      argumentStructures,
    },
  };
}
