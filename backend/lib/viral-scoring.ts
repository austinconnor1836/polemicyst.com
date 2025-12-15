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

export type ScoringMode = 'heuristic' | 'gemini' | 'hybrid';
export type TargetPlatform = 'all' | 'reels' | 'shorts' | 'youtube';
export type ContentStyle = 'politics' | 'comedy' | 'education' | 'podcast' | 'gaming' | 'vlog' | 'other';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function percentileOf(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp(Math.floor(p * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[idx];
}

export type DynamicSelectionOptions = {
  /** minimum number of candidates to return */
  minCandidates?: number;
  /** maximum number of candidates to return */
  maxCandidates?: number;
  /**
   * Hard minimum score cutoff. Useful for "only return truly viral" behavior.
   * Interpreted in the same score scale (0..10).
   */
  minScore?: number;
  /**
   * Percentile cutoff (0..1). Candidates below this percentile are discarded
   * unless needed to satisfy minCandidates.
   */
  percentile?: number;
  /**
   * If true, never include candidates below minScore. This allows returning fewer
   * than minCandidates when the video simply doesn't have enough "viral" moments.
   */
  strictMinScore?: boolean;
};

export type SelectionDiagnostics = {
  total: number;
  topScore: number;
  top3Avg: number;
  top5Avg: number;
  cutoff: number;
  minScore: number;
  percentile: number;
  strictMinScore: boolean;
  aboveCutoff: number;
};

export function computeSelectionDiagnostics<T extends { score: number }>(
  scored: T[],
  opts: DynamicSelectionOptions = {}
): SelectionDiagnostics {
  const minScore = opts.minScore ?? 6.0;
  const percentile = opts.percentile ?? 0.85;
  const strictMinScore = opts.strictMinScore ?? true;

  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score ?? 0;
  const top3 = sorted.slice(0, 3);
  const top5 = sorted.slice(0, 5);
  const top3Avg = top3.length ? top3.reduce((a, b) => a + b.score, 0) / top3.length : 0;
  const top5Avg = top5.length ? top5.reduce((a, b) => a + b.score, 0) / top5.length : 0;
  const cutoff = Math.max(minScore, percentileOf(sorted.map((s) => s.score), percentile));
  const aboveCutoff = sorted.filter((s) => s.score >= cutoff).length;

  return {
    total: sorted.length,
    topScore,
    top3Avg,
    top5Avg,
    cutoff,
    minScore,
    percentile,
    strictMinScore,
    aboveCutoff,
  };
}

export type VideoViralityDecision = {
  hasViralMoments: boolean;
  reason: 'no_candidates' | 'below_cutoff' | 'failed_quality_gate' | 'selected';
  diagnostics: SelectionDiagnostics;
  recommendation?: string;
};

export function decideVideoHasViralMoments<T extends { score: number; features?: Record<string, any> }>(params: {
  scored: T[];
  selection: DynamicSelectionOptions;
  targetPlatform?: TargetPlatform;
  saferClips?: boolean;
}): VideoViralityDecision {
  const { scored, selection, targetPlatform = 'all', saferClips = false } = params;

  const diagnostics = computeSelectionDiagnostics(scored, selection);
  if (!diagnostics.total) {
    return { hasViralMoments: false, reason: 'no_candidates', diagnostics };
  }

  const selected = selectCandidatesDynamically(scored, selection);
  if (!selected.length) {
    const close = diagnostics.topScore >= diagnostics.cutoff - 0.3;
    return {
      hasViralMoments: false,
      reason: 'below_cutoff',
      diagnostics,
      recommendation: close ? 'Try Loose strictness or lower minScore/percentile.' : 'Try Hybrid/Gemini scoring or enable audio.',
    };
  }

  // Extra guard: if the model explicitly marked *all selected* as non-viral, treat as no-viral.
  // (This should be rare because we already penalize those candidates’ scores.)
  const selectedWithSignal = selected.filter((c) => c.features?.hasViralMoment !== false);
  if (!selectedWithSignal.length) {
    return {
      hasViralMoments: false,
      reason: 'failed_quality_gate',
      diagnostics,
      recommendation: 'No strong moments detected. Try Loose strictness, different platform target, or Hybrid/Gemini.',
    };
  }

  // Platform-aware “quality gates”: require at least one strong hook/context/captionability signal,
  // so we don’t accept mediocre clips just because they passed a percentile cutoff.
  const maxHook = Math.max(...selected.map((c) => Number(c.features?.hookScore ?? 0)));
  const maxContext = Math.max(...selected.map((c) => Number(c.features?.contextScore ?? 0)));
  const maxCaption = Math.max(...selected.map((c) => Number(c.features?.captionabilityScore ?? 0)));
  const minRisk = Math.min(...selected.map((c) => Number(c.features?.riskScore ?? 0) || 0));

  const topIsStrong = diagnostics.topScore >= Math.max(7.0, diagnostics.cutoff + 0.4);
  const hookOk = maxHook >= 6.4;
  const contextOk = maxContext >= 6.4;
  const captionOk = maxCaption >= 6.0;

  let passes = true;
  let why = '';
  if (targetPlatform === 'reels' || targetPlatform === 'shorts') {
    passes = topIsStrong || (hookOk && (captionOk || diagnostics.topScore >= 7.5));
    why = 'needs stronger hook/captionability for Reels/Shorts';
  } else if (targetPlatform === 'youtube') {
    passes = topIsStrong || contextOk;
    why = 'needs more self-contained context for YouTube';
  } else {
    passes = topIsStrong || hookOk || contextOk;
    why = 'needs a stronger hook or clearer context';
  }

  // Safety guard: if safer clips is on and all selected are extremely risky, reject.
  if (passes && saferClips) {
    const tooRisky = minRisk >= 8.5 && diagnostics.topScore < 9.2;
    if (tooRisky) {
      passes = false;
      why = 'segments are too risky under safer-clips policy';
    }
  }

  if (!passes) {
    return {
      hasViralMoments: false,
      reason: 'failed_quality_gate',
      diagnostics,
      recommendation: `No high-quality viral moments (${why}). Try Loose strictness, enable audio, or switch platform target.`,
    };
  }

  return { hasViralMoments: true, reason: 'selected', diagnostics };
}

/**
 * Choose a variable number of candidates based on score distribution, with sane caps.
 * This is how we avoid "always returning N" even if a video has few (or many) viral moments.
 */
export function selectCandidatesDynamically<T extends { score: number }>(
  scored: T[],
  opts: DynamicSelectionOptions = {}
): T[] {
  const minCandidates = opts.minCandidates ?? 1;
  const maxCandidates = opts.maxCandidates ?? 20;
  const minScore = opts.minScore ?? 6.0;
  const percentile = opts.percentile ?? 0.85;
  const strictMinScore = opts.strictMinScore ?? true;

  const sorted = [...scored].sort((a, b) => b.score - a.score);
  if (!sorted.length) return [];

  const cutoff = Math.max(minScore, percentileOf(sorted.map((s) => s.score), percentile));
  let selected = sorted.filter((s) => s.score >= cutoff);

  if (selected.length < minCandidates) {
    if (strictMinScore) {
      // do not pad with low-scoring items; allow returning fewer results
      selected = selected.slice(0, selected.length);
    } else {
      selected = sorted.slice(0, Math.min(minCandidates, sorted.length));
    }
  }
  if (selected.length > maxCandidates) selected = selected.slice(0, maxCandidates);

  return selected;
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

/**
 * Hybrid scoring strategy:
 * - Heuristic prefilter to reduce cost
 * - Gemini multimodal rerank (frames + optional audio)
 */
export async function scoreAndRankCandidatesGeminiMultimodal(params: {
  s3Url: string;
  candidates: Array<Omit<ClipCandidate, 'score' | 'features'>>;
  topN: number;
  prefilterMultiplier?: number; // how many to keep before Gemini pass
  includeAudio?: boolean;
  modelName?: string;
  targetPlatform?: TargetPlatform;
  contentStyle?: ContentStyle;
  saferClips?: boolean;
}): Promise<ClipCandidate[]> {
  const {
    s3Url,
    candidates,
    topN,
    prefilterMultiplier = 3,
    includeAudio = true,
    modelName,
    targetPlatform = 'all',
    contentStyle,
    saferClips = false,
  } = params;

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('Missing GOOGLE_API_KEY for Gemini scoring');

  const { ensureLocalVideoForScoring, extractAudioMp3Base64, extractJpegFramesBase64, scoreSegmentWithGeminiMultimodal } =
    await import('./gemini-scoring');

  // Pre-score heuristically to choose which windows are worth Gemini calls
  const preRanked = candidates
    .map((c) => {
      const h = scoreCandidateHeuristic(c.text);
      return { ...c, hScore: h.score, hFeatures: h.features };
    })
    .sort((a, b) => b.hScore - a.hScore)
    .slice(0, Math.max(topN, topN * prefilterMultiplier));

  // Download source video once
  const cacheKey = Buffer.from(s3Url).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  const localVideoPath = await ensureLocalVideoForScoring({ s3Url, cacheKey });

  // Score sequentially (safe default). We can parallelize later with a small concurrency limit.
  const scored: ClipCandidate[] = [];
  for (const c of preRanked) {
    const frames = await extractJpegFramesBase64({
      videoPath: localVideoPath,
      tStartS: c.tStartS,
      tEndS: c.tEndS,
      maxFrames: 4,
    });
    const audio = includeAudio
      ? await extractAudioMp3Base64({
          videoPath: localVideoPath,
          tStartS: c.tStartS,
          tEndS: c.tEndS,
          maxSeconds: 18,
        })
      : null;

    const llm = await scoreSegmentWithGeminiMultimodal({
      apiKey,
      modelName,
      transcriptText: c.text,
      tStartS: c.tStartS,
      tEndS: c.tEndS,
      framesJpegBase64: frames,
      audioMp3Base64: audio,
      targetPlatform,
      contentStyle,
      saferClips,
    });

    const hook = llm.hookScore ?? llm.score;
    const risk = llm.riskScore ?? 0;
    const context = llm.contextScore ?? llm.score;
    const captionability = llm.captionabilityScore ?? llm.score;
    const viralPenalty = llm.hasViralMoment === false ? 1.25 : 0;

    const platformBoost =
      targetPlatform === 'reels' || targetPlatform === 'shorts'
        ? 0.50 * llm.score + 0.25 * hook + 0.15 * captionability + 0.10 * context
        : targetPlatform === 'youtube'
          ? 0.55 * llm.score + 0.25 * context + 0.10 * captionability + 0.10 * hook
          : 0.60 * llm.score + 0.20 * hook + 0.10 * captionability + 0.10 * context;

    const safetyPenalty = saferClips ? 0.35 * risk : 0;
    const finalScore = clamp(platformBoost - safetyPenalty - viralPenalty, 0, 10);

    scored.push({
      tStartS: c.tStartS,
      tEndS: c.tEndS,
      text: c.text,
      score: finalScore,
      features: {
        provider: 'gemini',
        rationale: llm.rationale,
        hookScore: llm.hookScore,
        contextScore: llm.contextScore,
        captionabilityScore: llm.captionabilityScore,
        comedicScore: llm.comedicScore,
        provocativeScore: llm.provocativeScore,
        visualEnergyScore: llm.visualEnergyScore,
        audioEnergyScore: llm.audioEnergyScore,
        riskScore: llm.riskScore,
        riskFlags: llm.riskFlags,
        hasViralMoment: llm.hasViralMoment,
        saferClips,
        targetPlatform,
        contentStyle,
        confidence: llm.confidence,
        durationS: Math.max(0, c.tEndS - c.tStartS),
      },
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, topN));
}


