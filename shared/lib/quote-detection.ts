/**
 * Detect quoted/cited material in a creator's transcript using LLM inference.
 *
 * Analyzes transcript segments to identify when a speaker reads or cites
 * external text (books, articles, documents) vs. giving their own commentary.
 * Returns structured quote objects with text, attribution, and time ranges.
 */

const fetch = require('node-fetch');

/**
 * How a quote overlay is rendered in the video.
 * - 'screenshot': navigate to sourceUrl and capture the page (requires sourceUrl)
 * - 'pull-quote' / 'lower-third' / 'highlight-card' / 'side-panel': generated text graphic
 * - 'auto': uses screenshot if sourceUrl present, otherwise falls back to composition style
 */
export type QuoteDisplayMode =
  | 'auto'
  | 'screenshot'
  | 'pull-quote'
  | 'lower-third'
  | 'highlight-card'
  | 'side-panel';

export interface DetectedQuote {
  /** The quoted text as spoken by the creator */
  text: string;
  /** Source attribution (e.g. "The New York Times", "1984 by George Orwell") */
  attribution: string | null;
  /** Start time in seconds (in transcript timeline) */
  startS: number;
  /** End time in seconds (in transcript timeline) */
  endS: number;
  /** LLM confidence 0..1 */
  confidence: number;
  /** URL to the source article/webpage (user-provided) */
  sourceUrl?: string | null;
  /** How this quote should be rendered — defaults to 'auto' */
  displayMode?: QuoteDisplayMode | null;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface QuoteDetectionResult {
  quotes: DetectedQuote[];
  provider: string;
  model?: string;
  _cost?: {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
    modelName?: string;
  };
}

function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1];
  return text;
}

function tryParseJson(text: string): any | null {
  const cleaned = stripCodeFences(text);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    const arrStart = cleaned.indexOf('[');
    const arrEnd = cleaned.lastIndexOf(']');
    if (arrStart === -1 || arrEnd === -1) return null;
    try {
      return { quotes: JSON.parse(cleaned.slice(arrStart, arrEnd + 1)) };
    } catch {
      return null;
    }
  }
}

/**
 * Build a chunked transcript string with timestamps for the LLM prompt.
 */
function buildTimestampedTranscript(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => `[${s.start.toFixed(1)}s-${s.end.toFixed(1)}s] ${s.text}`)
    .join('\n');
}

const QUOTE_DETECTION_PROMPT = `You are an expert at identifying when a speaker is reading or citing external text versus giving their own commentary.

Analyze the following timestamped transcript and identify segments where the speaker is reading, quoting, or citing material from external sources (books, articles, documents, tweets, posts, studies, etc.).

Look for cues like:
- Explicit attribution ("the article says...", "and I quote...", "according to...", "it reads...", "the passage states...")
- Shifts in language register (formal/written text being read aloud vs. conversational speech)
- The speaker prefacing or following up a passage with commentary about what they just read
- Direct quotation markers in speech patterns

Do NOT mark the speaker's own opinions, commentary, or paraphrasing as quotes. Only mark segments where they are reading or directly quoting external material.

For each detected quote, provide:
- "text": the exact quoted text as spoken (cleaned up, without the speaker's attribution phrasing)
- "attribution": the source if mentioned (book title, author, publication, etc.), or null if not stated
- "startS": start timestamp in seconds
- "endS": end timestamp in seconds
- "confidence": your confidence 0.0 to 1.0

Return ONLY valid JSON:
{"quotes": [{"text": "...", "attribution": "...", "startS": 0.0, "endS": 0.0, "confidence": 0.0}]}

If no quotes are found, return: {"quotes": []}

TRANSCRIPT:
`;

/**
 * Detect quotes in a transcript using Gemini.
 */
export async function detectQuotesWithGemini(
  segments: TranscriptSegment[],
  apiKey: string,
  modelName?: string
): Promise<QuoteDetectionResult> {
  const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  let chosenModel = modelName || process.env.GEMINI_MODEL;
  if (!chosenModel) {
    const res = await fetch(`${baseUrl}/models?key=${encodeURIComponent(apiKey)}`);
    const json = await res.json();
    const models = (json.models || []) as Array<{
      name: string;
      supportedGenerationMethods?: string[];
    }>;
    const flash = models.find(
      (m) =>
        /gemini/i.test(m.name) &&
        /flash/i.test(m.name) &&
        (m.supportedGenerationMethods || []).includes('generateContent')
    );
    chosenModel = flash?.name || models[0]?.name;
    if (!chosenModel) throw new Error('No Gemini models available');
  }
  if (!chosenModel.startsWith('models/')) {
    chosenModel = `models/${chosenModel}`;
  }

  const transcriptText = buildTimestampedTranscript(segments);
  const prompt = QUOTE_DETECTION_PROMPT + transcriptText;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1 },
  };

  const res = await fetch(
    `${baseUrl}/${chosenModel}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  const responseText = await res.text();
  let json: any;
  try {
    json = JSON.parse(responseText);
  } catch {
    throw new Error(`Gemini API returned non-JSON (${res.status}): ${responseText.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error(`Gemini quote detection failed (${res.status}): ${JSON.stringify(json)}`);
  }

  const usageMetadata = json?.usageMetadata;
  const text =
    json?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text)
      .filter(Boolean)
      .join('') ?? '';

  const parsed = tryParseJson(text);
  if (!parsed || !Array.isArray(parsed.quotes)) {
    console.warn('[quote-detection] Failed to parse LLM response, returning empty:', text.slice(0, 300));
    return { quotes: [], provider: 'gemini', model: chosenModel };
  }

  const quotes: DetectedQuote[] = parsed.quotes
    .filter((q: any) => q.text && typeof q.startS === 'number' && typeof q.endS === 'number')
    .map((q: any) => ({
      text: String(q.text).slice(0, 2000),
      attribution: q.attribution ? String(q.attribution).slice(0, 200) : null,
      startS: Number(q.startS),
      endS: Number(q.endS),
      confidence: Math.max(0, Math.min(1, Number(q.confidence) || 0.5)),
    }));

  return {
    quotes,
    provider: 'gemini',
    model: chosenModel,
    _cost: {
      inputTokens: usageMetadata?.promptTokenCount,
      outputTokens: usageMetadata?.candidatesTokenCount,
      estimatedCostUsd:
        usageMetadata?.promptTokenCount && usageMetadata?.candidatesTokenCount
          ? (usageMetadata.promptTokenCount / 1_000_000) * 0.075 +
            (usageMetadata.candidatesTokenCount / 1_000_000) * 0.3
          : undefined,
      modelName: chosenModel,
    },
  };
}

/**
 * Detect quotes using Ollama (local LLM).
 */
export async function detectQuotesWithOllama(
  segments: TranscriptSegment[]
): Promise<QuoteDetectionResult> {
  const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL || 'llama3';

  const transcriptText = buildTimestampedTranscript(segments);
  const prompt = QUOTE_DETECTION_PROMPT + transcriptText;

  const res = await fetch(`${host}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0.1 },
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama quote detection failed (${res.status})`);
  }

  const json = await res.json();
  const text = json.response || '';
  const parsed = tryParseJson(text);

  if (!parsed || !Array.isArray(parsed.quotes)) {
    console.warn('[quote-detection] Ollama: failed to parse response, returning empty');
    return { quotes: [], provider: 'ollama', model };
  }

  const quotes: DetectedQuote[] = parsed.quotes
    .filter((q: any) => q.text && typeof q.startS === 'number' && typeof q.endS === 'number')
    .map((q: any) => ({
      text: String(q.text).slice(0, 2000),
      attribution: q.attribution ? String(q.attribution).slice(0, 200) : null,
      startS: Number(q.startS),
      endS: Number(q.endS),
      confidence: Math.max(0, Math.min(1, Number(q.confidence) || 0.5)),
    }));

  return {
    quotes,
    provider: 'ollama',
    model,
    _cost: {
      inputTokens: json.prompt_eval_count,
      outputTokens: json.eval_count,
      estimatedCostUsd: 0,
      modelName: model,
    },
  };
}

/**
 * Detect quotes using the configured LLM provider.
 */
export async function detectQuotes(
  segments: TranscriptSegment[],
  provider?: string
): Promise<QuoteDetectionResult> {
  const effectiveProvider = (provider || process.env.LLM_PROVIDER || 'gemini').toLowerCase();

  if (effectiveProvider === 'gemini') {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      console.warn('[quote-detection] No GOOGLE_API_KEY, falling back to ollama');
      return detectQuotesWithOllama(segments);
    }
    return detectQuotesWithGemini(segments, apiKey);
  }

  return detectQuotesWithOllama(segments);
}
