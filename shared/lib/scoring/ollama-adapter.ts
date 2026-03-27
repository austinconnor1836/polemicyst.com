import type { LLMScoreResult } from './llm-types';
import type { ScoringProvider, ScoringInput } from './scoring-provider';

export class OllamaScoringAdapter implements ScoringProvider {
  readonly name = 'ollama';

  async scoreSegment(input: ScoringInput): Promise<LLMScoreResult> {
    const { scoreSegmentWithOllama, summarizeSegmentMedia } = await import('./ollama-scoring');

    let localVideoPath = input.localVideoPath;
    if (!localVideoPath && input.s3Url) {
      try {
        const { ensureLocalVideoForScoring } = await import('./gemini-scoring');
        const cacheKey = Buffer.from(input.s3Url)
          .toString('base64')
          .replace(/[^a-zA-Z0-9]/g, '')
          .slice(0, 24);
        localVideoPath = await ensureLocalVideoForScoring({ s3Url: input.s3Url, cacheKey });
      } catch (err) {
        console.warn(
          'Unable to cache video for Ollama scoring:',
          err instanceof Error ? err.message : err
        );
      }
    }

    const mediaSummary = localVideoPath
      ? await summarizeSegmentMedia({
          videoPath: localVideoPath,
          tStartS: input.tStartS,
          tEndS: input.tEndS,
          includeAudio: input.includeAudio,
        })
      : null;

    return scoreSegmentWithOllama({
      transcriptText: input.transcriptText,
      tStartS: input.tStartS,
      tEndS: input.tEndS,
      targetPlatform: input.targetPlatform,
      contentStyle: input.contentStyle,
      saferClips: input.saferClips,
      mediaSummary,
    });
  }
}
