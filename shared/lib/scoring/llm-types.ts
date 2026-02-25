export type LLMCostMeta = {
  inputTokens?: number;
  outputTokens?: number;
  inputImages?: number;
  audioSeconds?: number;
  estimatedCostUsd: number;
  modelName?: string;
  durationMs?: number;
};

export type LLMScoreResult = {
  score: number;
  rationale: string;
  hookScore?: number;
  contextScore?: number;
  captionabilityScore?: number;
  comedicScore?: number;
  provocativeScore?: number;
  visualEnergyScore?: number;
  audioEnergyScore?: number;
  riskScore?: number;
  riskFlags?: string[];
  hasViralMoment?: boolean;
  confidence?: number;
  /** Internal cost metadata — not a score field */
  _cost?: LLMCostMeta;
};
