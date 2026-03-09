import { prisma } from './prisma';

export type TrainingExampleInput = {
  provider: string;
  model?: string;

  // Input
  transcriptText: string;
  tStartS: number;
  tEndS: number;
  targetPlatform?: string;
  contentStyle?: string;
  saferClips?: boolean;
  includeAudio?: boolean;
  frameCount?: number;
  audioSeconds?: number;

  // Heuristic pre-score context
  heuristicScore?: number;
  heuristicFeatures?: Record<string, any>;

  // LLM output (raw scores before aggregation)
  llmScore: number;
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
  rationale?: string;

  // Post-aggregation
  finalScore: number;

  // Cost metadata
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  durationMs?: number;
};

/**
 * Accumulates LLM scoring input/output pairs for model distillation.
 * Same pattern as CostTracker: in-memory buffer, single flush at job end, non-fatal.
 */
export class TrainingCollector {
  private examples: TrainingExampleInput[] = [];
  readonly userId: string;
  readonly jobId: string;

  constructor(userId: string, jobId: string) {
    this.userId = userId;
    this.jobId = jobId;
  }

  add(example: TrainingExampleInput): void {
    this.examples.push(example);
  }

  get count(): number {
    return this.examples.length;
  }

  /**
   * Mark which candidates were selected into the final clip set.
   * Matches by time range (tStartS/tEndS) with a small tolerance.
   */
  markSelected(selectedTimeRanges: Array<{ tStartS: number; tEndS: number }>): void {
    const TOLERANCE = 0.5; // seconds
    for (const ex of this.examples) {
      const matched = selectedTimeRanges.some(
        (sel) =>
          Math.abs(sel.tStartS - ex.tStartS) < TOLERANCE &&
          Math.abs(sel.tEndS - ex.tEndS) < TOLERANCE
      );
      if (matched) {
        (ex as any)._wasSelected = true;
      }
    }
  }

  async flush(): Promise<void> {
    if (!this.examples.length) return;

    try {
      await prisma.trainingExample.createMany({
        data: this.examples.map((ex) => ({
          userId: this.userId,
          jobId: this.jobId,
          provider: ex.provider,
          model: ex.model ?? null,
          transcriptText: ex.transcriptText,
          tStartS: ex.tStartS,
          tEndS: ex.tEndS,
          targetPlatform: ex.targetPlatform ?? 'all',
          contentStyle: ex.contentStyle ?? null,
          saferClips: ex.saferClips ?? false,
          includeAudio: ex.includeAudio ?? false,
          frameCount: ex.frameCount ?? 0,
          audioSeconds: ex.audioSeconds ?? 0,
          heuristicScore: ex.heuristicScore ?? null,
          heuristicFeatures: ex.heuristicFeatures ?? undefined,
          llmScore: ex.llmScore,
          hookScore: ex.hookScore ?? null,
          contextScore: ex.contextScore ?? null,
          captionabilityScore: ex.captionabilityScore ?? null,
          comedicScore: ex.comedicScore ?? null,
          provocativeScore: ex.provocativeScore ?? null,
          visualEnergyScore: ex.visualEnergyScore ?? null,
          audioEnergyScore: ex.audioEnergyScore ?? null,
          riskScore: ex.riskScore ?? null,
          riskFlags: ex.riskFlags ?? undefined,
          hasViralMoment: ex.hasViralMoment ?? null,
          confidence: ex.confidence ?? null,
          rationale: ex.rationale ?? null,
          finalScore: ex.finalScore,
          wasSelected: (ex as any)._wasSelected ?? false,
          inputTokens: ex.inputTokens ?? null,
          outputTokens: ex.outputTokens ?? null,
          estimatedCostUsd: ex.estimatedCostUsd ?? null,
          durationMs: ex.durationMs ?? null,
        })),
      });
      console.log(`🧠 Flushed ${this.examples.length} training examples for job ${this.jobId}`);
    } catch (err) {
      console.error('⚠️ Failed to flush training examples (non-fatal):', err);
    }
  }
}
