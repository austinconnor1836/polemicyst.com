import type { LLMScoreResult } from './llm-types';
import type { TargetPlatform, ContentStyle } from '../../virality';

/**
 * Input context passed to an LLM scoring provider for a single candidate segment.
 */
export interface ScoringInput {
  transcriptText: string;
  tStartS: number;
  tEndS: number;
  targetPlatform: TargetPlatform;
  contentStyle?: ContentStyle;
  saferClips: boolean;
  includeAudio: boolean;
  s3Url?: string;
  localVideoPath?: string;
}

/**
 * Port interface for LLM-based clip scoring.
 *
 * Each adapter encapsulates provider-specific details (API keys, endpoints,
 * media extraction, prompt formatting) behind this contract. The scoring
 * orchestrator in viral-scoring.ts depends only on this interface.
 */
export interface ScoringProvider {
  readonly name: string;
  scoreSegment(input: ScoringInput): Promise<LLMScoreResult>;
}

/**
 * Resolve the appropriate ScoringProvider adapter for the given provider key.
 * Lazily imports adapters to avoid loading both modules when only one is needed.
 */
export async function createScoringProvider(
  provider: string,
  options?: { modelName?: string }
): Promise<ScoringProvider> {
  const key = (provider || 'ollama').toLowerCase();

  if (key === 'gemini') {
    const { GeminiScoringAdapter } = await import('./gemini-adapter');
    return new GeminiScoringAdapter(options?.modelName);
  }

  const { OllamaScoringAdapter } = await import('./ollama-adapter');
  return new OllamaScoringAdapter();
}
