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
};
