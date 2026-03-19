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

export type CaptionFont =
  | 'Inter'
  | 'Helvetica Neue'
  | 'DejaVu Sans'
  | 'Liberation Sans'
  | 'Cascadia Code'
  | 'JetBrains Mono'
  | 'DejaVu Sans Mono';

export type CaptionFontSize = 'small' | 'medium' | 'large' | 'xlarge';

export const CAPTION_FONTS: { value: CaptionFont; label: string }[] = [
  { value: 'Inter', label: 'Inter' },
  { value: 'Helvetica Neue', label: 'Helvetica Neue' },
  { value: 'DejaVu Sans', label: 'DejaVu Sans' },
  { value: 'Liberation Sans', label: 'Liberation Sans' },
  { value: 'Cascadia Code', label: 'Cascadia Code (Mono)' },
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'DejaVu Sans Mono', label: 'DejaVu Sans Mono' },
];

export const CAPTION_FONT_SIZES: { value: CaptionFontSize; label: string; px: number }[] = [
  { value: 'small', label: 'Small', px: 24 },
  { value: 'medium', label: 'Medium', px: 36 },
  { value: 'large', label: 'Large', px: 48 },
  { value: 'xlarge', label: 'Extra Large', px: 64 },
];

export function getCaptionFontSizePx(size?: CaptionFontSize): number {
  return CAPTION_FONT_SIZES.find((s) => s.value === size)?.px ?? 36;
}

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
  captionsEnabled: boolean;
  captionFont: CaptionFont;
  captionFontSize: CaptionFontSize;
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
  captionsEnabled: false,
  captionFont: 'Inter',
  captionFontSize: 'medium',
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
