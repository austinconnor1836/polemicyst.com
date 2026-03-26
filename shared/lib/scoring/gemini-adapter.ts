import type { LLMScoreResult } from './llm-types';
import type { ScoringProvider, ScoringInput } from './scoring-provider';

export class GeminiScoringAdapter implements ScoringProvider {
  readonly name = 'gemini';
  private modelName?: string;

  constructor(modelName?: string) {
    this.modelName = modelName;
  }

  async scoreSegment(input: ScoringInput): Promise<LLMScoreResult> {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error('Missing GOOGLE_API_KEY for Gemini scoring');

    const {
      extractJpegFramesBase64,
      extractAudioMp3Base64,
      scoreSegmentWithGeminiMultimodal,
      ensureLocalVideoForScoring,
    } = await import('./gemini-scoring');

    let localVideoPath = input.localVideoPath;
    if (!localVideoPath && input.s3Url) {
      const cacheKey = Buffer.from(input.s3Url)
        .toString('base64')
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 24);
      localVideoPath = await ensureLocalVideoForScoring({ s3Url: input.s3Url, cacheKey });
    }

    if (!localVideoPath) {
      throw new Error('Gemini scoring requires a video file (s3Url or localVideoPath)');
    }

    const frames = await extractJpegFramesBase64({
      videoPath: localVideoPath,
      tStartS: input.tStartS,
      tEndS: input.tEndS,
      maxFrames: 4,
    });

    const audio = input.includeAudio
      ? await extractAudioMp3Base64({
          videoPath: localVideoPath,
          tStartS: input.tStartS,
          tEndS: input.tEndS,
          maxSeconds: 18,
        })
      : null;

    return scoreSegmentWithGeminiMultimodal({
      apiKey,
      modelName: this.modelName,
      transcriptText: input.transcriptText,
      tStartS: input.tStartS,
      tEndS: input.tEndS,
      framesJpegBase64: frames,
      audioMp3Base64: audio,
      targetPlatform: input.targetPlatform,
      contentStyle: input.contentStyle,
      saferClips: input.saferClips,
    });
  }
}
