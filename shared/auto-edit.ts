// Auto-Edit types, defaults, and helpers
// Detects and removes dead space (silence) and bad takes from creator footage

export type Aggressiveness = 'conservative' | 'balanced' | 'aggressive';

export type AutoEditSettings = {
  minSilenceToKeepS: number; // Buffer to keep on each side of a silence cut
  badTakeDetection: boolean; // Enable detection of repeated phrases / false starts
  aggressiveness: Aggressiveness;
};

export type AutoEditCutReason = 'silence' | 'bad_take';

export type AutoEditCut = {
  id: string;
  startS: number;
  endS: number;
  reason: AutoEditCutReason;
  detail: string;
};

export type AutoEditSummary = {
  silenceCuts: number;
  badTakeCuts: number;
  totalCuts: number;
  totalRemovedS: number;
  originalDurationS: number;
  newDurationS: number;
};

export type AutoEditResult = {
  cuts: AutoEditCut[];
  summary: AutoEditSummary;
};

export const DEFAULT_AUTO_EDIT_SETTINGS: AutoEditSettings = {
  minSilenceToKeepS: 0.5,
  badTakeDetection: true,
  aggressiveness: 'balanced',
};

export type AggressivenessConfig = {
  silenceThresholdDb: number; // FFmpeg silencedetect noise threshold (dB)
  minSilenceDurationS: number; // Minimum silence duration for FFmpeg to detect (seconds)
  minSilenceToKeepS: number; // Buffer to keep on each side of a silence cut
};

const AGGRESSIVENESS_CONFIGS: Record<Aggressiveness, AggressivenessConfig> = {
  conservative: { silenceThresholdDb: -35, minSilenceDurationS: 3.0, minSilenceToKeepS: 0.75 },
  balanced: { silenceThresholdDb: -30, minSilenceDurationS: 1.5, minSilenceToKeepS: 0.5 },
  aggressive: { silenceThresholdDb: -25, minSilenceDurationS: 0.75, minSilenceToKeepS: 0.25 },
};

export function getAggressivenessConfig(aggressiveness: Aggressiveness): AggressivenessConfig {
  return AGGRESSIVENESS_CONFIGS[aggressiveness] ?? AGGRESSIVENESS_CONFIGS.balanced;
}

export function mergeAutoEditSettings(value?: Partial<AutoEditSettings> | null): AutoEditSettings {
  return { ...DEFAULT_AUTO_EDIT_SETTINGS, ...(value ?? {}) };
}
