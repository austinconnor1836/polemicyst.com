export type ScoringMode = 'hybrid' | 'gemini' | 'heuristic';
export type StrictnessPreset = 'strict' | 'balanced' | 'loose';
export type TargetPlatform = 'all' | 'reels' | 'shorts' | 'youtube';
export type ContentStyle =
  | 'auto'
  | 'politics'
  | 'comedy'
  | 'education'
  | 'podcast'
  | 'gaming'
  | 'vlog'
  | 'other';

export type StrictnessConfig = {
  minCandidates: number;
  maxCandidates: number;
  minScore: number;
  percentile: number;
  maxGeminiCandidates: number;
};

export type LLMProvider = 'gemini' | 'ollama';

export type ClipLengthPreference = 'auto' | 'lt30s' | '30s-60s' | '60s-90s' | 'lt3m';

export type ViralitySettingsValue = {
  scoringMode: ScoringMode;
  strictnessPreset: StrictnessPreset;
  includeAudio: boolean;
  saferClips: boolean;
  targetPlatform: TargetPlatform;
  contentStyle: ContentStyle;
  showAdvanced: boolean;
  llmProvider: LLMProvider;
  clipLength: ClipLengthPreference;
  showTimestamp: boolean;
};

export const DEFAULT_VIRALITY_SETTINGS: ViralitySettingsValue = {
  scoringMode: 'hybrid',
  strictnessPreset: 'balanced',
  includeAudio: false,
  saferClips: true,
  targetPlatform: 'reels',
  contentStyle: 'auto',
  showAdvanced: false,
  llmProvider: 'ollama',
  clipLength: 'auto',
  showTimestamp: false,
};

export function getStrictnessConfig(preset: StrictnessPreset): StrictnessConfig {
  switch (preset) {
    case 'strict':
      return {
        minScore: 7.0,
        percentile: 0.9,
        minCandidates: 3,
        maxCandidates: 12,
        maxGeminiCandidates: 18,
      };
    case 'loose':
      return {
        minScore: 6.0,
        percentile: 0.75,
        minCandidates: 5,
        maxCandidates: 24,
        maxGeminiCandidates: 36,
      };
    case 'balanced':
    default:
      return {
        minScore: 6.5,
        percentile: 0.85,
        minCandidates: 3,
        maxCandidates: 20,
        maxGeminiCandidates: 24,
      };
  }
}

export function mergeViralitySettings(
  value?: Partial<ViralitySettingsValue> | null,
  fallbackProvider: LLMProvider = DEFAULT_VIRALITY_SETTINGS.llmProvider
): ViralitySettingsValue {
  const merged = { ...DEFAULT_VIRALITY_SETTINGS, ...(value ?? {}) };
  return {
    ...merged,
    llmProvider: (value?.llmProvider as LLMProvider | undefined) ?? fallbackProvider,
  };
}
