import { prisma } from './prisma';

export type CostStage =
  | 'download'
  | 'transcription'
  | 'llm_scoring'
  | 'ffmpeg_render'
  | 's3_upload';

export type CostEventInput = {
  stage: CostStage;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  inputImages?: number;
  inputAudioS?: number;
  durationMs?: number;
  fileSizeBytes?: number;
  estimatedCostUsd?: number;
  metadata?: Record<string, any>;
};

// Gemini Flash pricing (as of 2025)
const GEMINI_INPUT_PER_1M = 0.075; // $/1M input tokens
const GEMINI_OUTPUT_PER_1M = 0.3; // $/1M output tokens
const GEMINI_TOKENS_PER_IMAGE = 258;
const GEMINI_AUDIO_TOKENS_PER_SECOND = 32; // ~32 tokens/sec for audio

// S3 pricing estimates
const S3_PUT_PER_1K = 0.005; // $/1K PUT requests
const S3_BANDWIDTH_PER_GB = 0.09; // $/GB transfer out

export function estimateGeminiCost(params: {
  numFrames?: number;
  audioSeconds?: number;
  transcriptChars?: number;
  outputTokens?: number;
}): { inputTokens: number; outputTokens: number; estimatedCostUsd: number } {
  const { numFrames = 0, audioSeconds = 0, transcriptChars = 0, outputTokens = 200 } = params;

  // Rough estimate: ~4 chars per token for English text
  const textTokens = Math.ceil(transcriptChars / 4);
  const imageTokens = numFrames * GEMINI_TOKENS_PER_IMAGE;
  const audioTokens = Math.ceil(audioSeconds * GEMINI_AUDIO_TOKENS_PER_SECOND);

  const inputTokens = textTokens + imageTokens + audioTokens;
  const costInput = (inputTokens / 1_000_000) * GEMINI_INPUT_PER_1M;
  const costOutput = (outputTokens / 1_000_000) * GEMINI_OUTPUT_PER_1M;

  return {
    inputTokens,
    outputTokens,
    estimatedCostUsd: costInput + costOutput,
  };
}

export function estimateS3Cost(fileSizeBytes: number): number {
  const gb = fileSizeBytes / (1024 * 1024 * 1024);
  return S3_PUT_PER_1K / 1000 + gb * S3_BANDWIDTH_PER_GB;
}

export class CostTracker {
  private events: CostEventInput[] = [];
  readonly userId: string;
  readonly jobId: string;

  constructor(userId: string, jobId: string) {
    this.userId = userId;
    this.jobId = jobId;
  }

  add(event: CostEventInput): void {
    this.events.push(event);
  }

  /**
   * Wraps an async operation, auto-recording durationMs.
   * The `buildEvent` callback receives the result so you can extract
   * cost fields (e.g., token counts) from the return value.
   */
  async track<T>(
    stage: CostStage,
    fn: () => Promise<T>,
    buildEvent?: (result: T, durationMs: number) => Omit<CostEventInput, 'stage' | 'durationMs'>
  ): Promise<T> {
    const start = Date.now();
    const result = await fn();
    const durationMs = Date.now() - start;

    const extra = buildEvent ? buildEvent(result, durationMs) : {};
    this.events.push({ stage, durationMs, ...extra });

    return result;
  }

  get totalCostUsd(): number {
    return this.events.reduce((sum, e) => sum + (e.estimatedCostUsd ?? 0), 0);
  }

  get eventCount(): number {
    return this.events.length;
  }

  async flush(): Promise<void> {
    if (!this.events.length) return;

    try {
      await prisma.costEvent.createMany({
        data: this.events.map((e) => ({
          userId: this.userId,
          jobId: this.jobId,
          stage: e.stage,
          provider: e.provider ?? null,
          model: e.model ?? null,
          inputTokens: e.inputTokens ?? null,
          outputTokens: e.outputTokens ?? null,
          inputImages: e.inputImages ?? null,
          inputAudioS: e.inputAudioS ?? null,
          durationMs: e.durationMs ?? null,
          fileSizeBytes: e.fileSizeBytes != null ? BigInt(e.fileSizeBytes) : null,
          estimatedCostUsd: e.estimatedCostUsd ?? 0,
          metadata: e.metadata ?? undefined,
        })),
      });
      console.log(
        `💰 Flushed ${this.events.length} cost events (total: $${this.totalCostUsd.toFixed(6)}) for job ${this.jobId}`
      );
    } catch (err) {
      console.error('⚠️ Failed to flush cost events (non-fatal):', err);
    }
  }
}
