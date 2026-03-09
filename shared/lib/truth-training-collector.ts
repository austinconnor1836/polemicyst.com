import { prisma } from './prisma';

export type TruthTrainingInput = {
  provider: string;
  model?: string;
  type: 'analysis' | 'chat';

  // Input
  transcriptText: string;
  analysisContext?: Record<string, any>; // for chat: the analysis result used as context
  conversationHistory?: Array<{ role: string; content: string }>; // for chat: prior messages

  // Output
  result: Record<string, any>; // analysis: TruthAnalysisResult, chat: { content: string }

  // Quality signals (from analysis result)
  overallCredibility?: number;
  assertionCount?: number;
  fallacyCount?: number;
  biasCount?: number;

  // Cost metadata
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  durationMs?: number;
};

/**
 * Accumulates truth analysis and chat LLM input/output pairs for model distillation.
 * Same pattern as CostTracker/TrainingCollector: in-memory buffer, single flush, non-fatal.
 */
export class TruthTrainingCollector {
  private examples: TruthTrainingInput[] = [];
  readonly userId: string;
  readonly feedVideoId: string;

  constructor(userId: string, feedVideoId: string) {
    this.userId = userId;
    this.feedVideoId = feedVideoId;
  }

  add(example: TruthTrainingInput): void {
    this.examples.push(example);
  }

  get count(): number {
    return this.examples.length;
  }

  async flush(): Promise<void> {
    if (!this.examples.length) return;

    try {
      await prisma.truthTrainingExample.createMany({
        data: this.examples.map((ex) => ({
          userId: this.userId,
          feedVideoId: this.feedVideoId,
          provider: ex.provider,
          model: ex.model ?? null,
          type: ex.type,
          transcriptText: ex.transcriptText,
          analysisContext: ex.analysisContext ?? undefined,
          conversationHistory: ex.conversationHistory ?? undefined,
          result: ex.result,
          overallCredibility: ex.overallCredibility ?? null,
          assertionCount: ex.assertionCount ?? null,
          fallacyCount: ex.fallacyCount ?? null,
          biasCount: ex.biasCount ?? null,
          inputTokens: ex.inputTokens ?? null,
          outputTokens: ex.outputTokens ?? null,
          estimatedCostUsd: ex.estimatedCostUsd ?? null,
          durationMs: ex.durationMs ?? null,
        })),
      });
      console.log(
        `🧠 Flushed ${this.examples.length} truth training examples for feedVideo ${this.feedVideoId}`
      );
    } catch (err) {
      console.error('⚠️ Failed to flush truth training examples (non-fatal):', err);
    }
  }
}
