/**
 * Port interface for video person-segmentation.
 *
 * The stitch-render worker needs per-frame alpha masks for clips with
 * `removeBackground = true`. We model this as a port so the MediaPipe
 * sidecar can be swapped for something heavier-weight later
 * (BackgroundMattingV2, server-side RVM, etc.) without touching the
 * orchestrator. Follows the same Ports/Adapters pattern as
 * `shared/lib/scoring/scoring-provider.ts` and
 * `shared/lib/storage/storage-provider.ts`.
 */

export interface SegmentationResult {
  framesProcessed: number;
  durationMs: number;
  /**
   * Mirrors `LLMScoreResult._cost` — fed into the `CostTracker` by the worker
   * so per-clip segmentation cost shows up alongside ffmpeg + S3 cost.
   * Optional because local-compute adapters (MediaPipe via Python) have $0 cost.
   */
  _cost?: { provider: string; estimatedCostUsd: number };
}

export interface SegmentationProvider {
  readonly name: string;
  /**
   * Run person segmentation on `inputPath` and write a single-channel mp4
   * mask video to `outputPath`. The mask is the alpha channel a downstream
   * FFmpeg `alphamerge` filter can use to composite the segmented subject
   * over an arbitrary background.
   *
   * Implementations must:
   *   - emit the same frame rate as the input (so timestamps line up),
   *   - produce a video with identical width/height to the input,
   *   - return an empty/error result if the input has zero frames.
   */
  segmentVideo(inputPath: string, outputPath: string): Promise<SegmentationResult>;
}

/**
 * Resolve the appropriate SegmentationProvider adapter for the given name.
 * Lazily imports adapters to avoid loading native deps when unused.
 *
 * Default: 'mediapipe' (the only adapter shipped today).
 */
export async function createSegmentationProvider(name?: string): Promise<SegmentationProvider> {
  const key = (name || process.env.SEGMENTATION_PROVIDER || 'mediapipe').toLowerCase();
  if (key === 'mediapipe') {
    const { MediaPipeSegmentationAdapter } = await import('./mediapipe-adapter');
    return new MediaPipeSegmentationAdapter();
  }
  throw new Error(`Unknown segmentation provider: ${key}`);
}
