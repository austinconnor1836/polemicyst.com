const fetch = require('node-fetch');
import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { spawn } from 'child_process';
import type { LLMScoreResult } from './llm-types';
import { estimateGeminiCost } from '../cost-tracking';

export type GeminiScoreResult = LLMScoreResult;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1];
  return text;
}

function tryParseJsonLoose(text: string): any | null {
  const cleaned = stripCodeFences(text);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;

  const fragment = cleaned.slice(start, end + 1);
  const attempts = [
    fragment,
    // Quote bare keys
    fragment.replace(/(?<=^|{|,)\s*([A-Za-z0-9_]+)\s*:/g, '"$1":'),
  ].map((f) => f.replace(/,(\s*[}\]])/g, '$1')); // drop trailing commas

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      // try next
    }
  }
  return null;
}

function parseKeyValueFallback(text: string): Record<string, any> | null {
  const fields = [
    'score',
    'hookScore',
    'contextScore',
    'captionabilityScore',
    'comedicScore',
    'provocativeScore',
    'visualEnergyScore',
    'audioEnergyScore',
    'riskScore',
    'confidence',
  ];
  const parsed: Record<string, any> = {};
  for (const f of fields) {
    const m = text.match(new RegExp(`${f}\\s*[:=]\\s*([-\\d\\.]+)`, 'i'));
    if (m) parsed[f] = Number(m[1]);
  }
  const rationaleMatch = text.match(/rationale\s*[:=]\s*(.+)/i);
  if (rationaleMatch) parsed.rationale = rationaleMatch[1].trim();
  return Object.keys(parsed).length ? parsed : null;
}

async function downloadToTmp(url: string, outPath: string): Promise<void> {
  const res = await fetch(url);
  const body = res.body;
  if (!res.ok || !body) throw new Error(`Failed to download media (${res.status})`);

  await fs.mkdir(path.dirname(outPath), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(outPath);
    body.pipe(out);
    body.on('error', reject);
    out.on('finish', resolve);
  });
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ffmpeg.stderr.on('data', (d) => (err += d.toString()));
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${err}`));
    });
  });
}

async function fileToBase64(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return buf.toString('base64');
}

export async function extractJpegFramesBase64(params: {
  videoPath: string;
  tStartS: number;
  tEndS: number;
  maxFrames?: number;
}): Promise<string[]> {
  const { videoPath, tStartS, tEndS, maxFrames = 4 } = params;
  const duration = Math.max(1, tEndS - tStartS);
  const fps = clamp(maxFrames / duration, 0.2, 1.0); // 0.2..1 fps

  const outDir = path.join(
    '/tmp',
    `gemini-frames-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  await fs.mkdir(outDir, { recursive: true });
  const outPattern = path.join(outDir, 'frame-%03d.jpg');

  await runFfmpeg([
    '-y',
    '-ss',
    `${tStartS}`,
    '-t',
    `${duration}`,
    '-i',
    videoPath,
    '-vf',
    `fps=${fps},scale=640:-1`,
    '-q:v',
    '4',
    outPattern,
  ]);

  const files = (await fs.readdir(outDir))
    .filter((f) => f.endsWith('.jpg'))
    .sort()
    .slice(0, maxFrames)
    .map((f) => path.join(outDir, f));

  const b64s = [];
  for (const f of files) b64s.push(await fileToBase64(f));

  // best-effort cleanup
  await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});

  return b64s;
}

export async function extractAudioMp3Base64(params: {
  videoPath: string;
  tStartS: number;
  tEndS: number;
  maxSeconds?: number;
}): Promise<string | null> {
  const { videoPath, tStartS, tEndS, maxSeconds = 18 } = params;
  const duration = Math.max(1, Math.min(maxSeconds, tEndS - tStartS));
  const outPath = path.join(
    '/tmp',
    `gemini-audio-${Date.now()}-${Math.random().toString(16).slice(2)}.mp3`
  );

  // Extract mono audio to keep size low
  await runFfmpeg([
    '-y',
    '-ss',
    `${tStartS}`,
    '-t',
    `${duration}`,
    '-i',
    videoPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-b:a',
    '48k',
    outPath,
  ]);

  const b64 = await fileToBase64(outPath);
  await fs.unlink(outPath).catch(() => {});
  return b64 || null;
}

export async function scoreSegmentWithGeminiMultimodal(params: {
  apiKey: string;
  modelName?: string;
  transcriptText: string;
  tStartS: number;
  tEndS: number;
  framesJpegBase64: string[];
  audioMp3Base64?: string | null;
  targetPlatform?: 'all' | 'reels' | 'shorts' | 'youtube';
  contentStyle?: 'politics' | 'comedy' | 'education' | 'podcast' | 'gaming' | 'vlog' | 'other';
  saferClips?: boolean;
}): Promise<GeminiScoreResult> {
  const {
    apiKey,
    // Model IDs change over time; we can auto-discover a working model from the API if not provided.
    modelName = process.env.GEMINI_MODEL,
    transcriptText,
    tStartS,
    tEndS,
    framesJpegBase64,
    audioMp3Base64,
    targetPlatform = 'all',
    contentStyle,
    saferClips = false,
  } = params;

  const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  async function listModels(): Promise<
    Array<{ name: string; supportedGenerationMethods?: string[] }>
  > {
    const res = await fetch(`${baseUrl}/models?key=${encodeURIComponent(apiKey)}`);
    const json = await res.json();
    if (!res.ok) {
      throw new Error(`ListModels failed (${res.status}): ${JSON.stringify(json)}`);
    }
    return (json.models || []) as Array<{ name: string; supportedGenerationMethods?: string[] }>;
  }

  async function pickDefaultModel(): Promise<string> {
    const models = await listModels();
    const supportsGenerate = models.filter((m) =>
      (m.supportedGenerationMethods || []).includes('generateContent')
    );

    // Prefer Flash (faster), then Pro, else first supported.
    const flash = supportsGenerate.find((m) => /gemini/i.test(m.name) && /flash/i.test(m.name));
    if (flash) return flash.name;
    const pro = supportsGenerate.find((m) => /gemini/i.test(m.name) && /pro/i.test(m.name));
    if (pro) return pro.name;
    const first = supportsGenerate[0];
    if (!first) throw new Error('No models available that support generateContent');
    return first.name;
  }

  let chosenModel = modelName || (await pickDefaultModel());
  if (!chosenModel.startsWith('models/')) {
    chosenModel = `models/${chosenModel}`;
  }

  const prompt = [
    `You are a ruthless short-form video editor optimizing for virality on ${targetPlatform}.`,
    contentStyle ? `Content style: ${contentStyle}.` : ``,
    saferClips
      ? `Safety mode: ON. Downrank risky segments. Prefer accurate, context-complete clips that minimize defamation/misinformation risk.`
      : `Safety mode: OFF. Focus purely on virality.`,
    `Score this candidate clip window using BOTH the transcript and the provided frames (and audio if present).`,
    ``,
    `Window: start=${tStartS.toFixed(2)}s end=${tEndS.toFixed(2)}s`,
    `Transcript: """${transcriptText}"""`,
    ``,
    `Return ONLY valid JSON with this shape:`,
    `{"score":0-10,"hookScore":0-10,"contextScore":0-10,"captionabilityScore":0-10,"comedicScore":0-10,"provocativeScore":0-10,"visualEnergyScore":0-10,"audioEnergyScore":0-10,"riskScore":0-10,"riskFlags":["..."],"hasViralMoment":true/false,"confidence":0-1,"rationale":"..."}`,
    ``,
    `Rules:`,
    `- score must be a number 0..10`,
    `- hookScore/contextScore/captionabilityScore must be numbers 0..10`,
    `- riskScore must be a number 0..10 (higher = riskier)`,
    `- riskFlags must be a JSON array of strings (empty array if none)`,
    `- hasViralMoment must be a boolean`,
    `- confidence must be 0..1`,
    `- rationale must be <= 2 sentences, high-signal`,
  ].join('\n');

  const parts: any[] = [{ text: prompt }];
  for (const b64 of framesJpegBase64) {
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: b64,
      },
    });
  }
  if (audioMp3Base64) {
    parts.push({
      inlineData: {
        mimeType: 'audio/mpeg',
        data: audioMp3Base64,
      },
    });
  }

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.2 },
  };

  console.log(`📡 Calling Gemini API (${chosenModel}) for segment ${tStartS}-${tEndS}...`);
  const res = await fetch(
    `${baseUrl}/${chosenModel}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  console.log(`📨 Received response from Gemini (${res.status})`);

  const responseText = await res.text();
  let json;
  try {
    json = JSON.parse(responseText);
  } catch (e) {
    // If not JSON, it's likely a plaintext error from Google Frontends
    throw new Error(`Gemini API returned ${res.status} (Non-JSON): ${responseText}`);
  }

  if (!res.ok) {
    throw new Error(`Gemini generateContent failed (${res.status}): ${JSON.stringify(json)}`);
  }

  // Extract usage metadata for cost tracking
  const usageMetadata = json?.usageMetadata;
  const actualInputTokens = usageMetadata?.promptTokenCount as number | undefined;
  const actualOutputTokens = usageMetadata?.candidatesTokenCount as number | undefined;

  const text =
    json?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text)
      .filter(Boolean)
      .join('') ?? JSON.stringify(json);

  const parsedJson = tryParseJsonLoose(text);
  const parsedKv = parsedJson ? null : parseKeyValueFallback(text);
  if (!parsedJson && parsedKv) {
    console.warn('⚠️ Gemini returned unstructured text; parsed via fallback KV extraction.');
  }
  const parsed =
    parsedJson ??
    parsedKv ??
    (() => {
      throw new Error(`Gemini returned non-JSON: ${text.slice(0, 200)}`);
    })();

  // Compute cost: use actual tokens from API if available, otherwise estimate
  const audioSeconds = audioMp3Base64 ? Math.min(18, tEndS - tStartS) : 0;
  const costEstimate = estimateGeminiCost({
    numFrames: framesJpegBase64.length,
    audioSeconds,
    transcriptChars: transcriptText.length,
    outputTokens: actualOutputTokens,
  });

  const costMeta = {
    inputTokens: actualInputTokens ?? costEstimate.inputTokens,
    outputTokens: actualOutputTokens ?? costEstimate.outputTokens,
    inputImages: framesJpegBase64.length,
    audioSeconds,
    estimatedCostUsd: actualInputTokens
      ? (actualInputTokens / 1_000_000) * 0.075 + ((actualOutputTokens ?? 200) / 1_000_000) * 0.3
      : costEstimate.estimatedCostUsd,
    modelName: chosenModel,
  };

  return {
    score: clamp(Number(parsed.score), 0, 10),
    hookScore: parsed.hookScore != null ? clamp(Number(parsed.hookScore), 0, 10) : undefined,
    contextScore:
      parsed.contextScore != null ? clamp(Number(parsed.contextScore), 0, 10) : undefined,
    captionabilityScore:
      parsed.captionabilityScore != null
        ? clamp(Number(parsed.captionabilityScore), 0, 10)
        : undefined,
    comedicScore:
      parsed.comedicScore != null ? clamp(Number(parsed.comedicScore), 0, 10) : undefined,
    provocativeScore:
      parsed.provocativeScore != null ? clamp(Number(parsed.provocativeScore), 0, 10) : undefined,
    visualEnergyScore:
      parsed.visualEnergyScore != null ? clamp(Number(parsed.visualEnergyScore), 0, 10) : undefined,
    audioEnergyScore:
      parsed.audioEnergyScore != null ? clamp(Number(parsed.audioEnergyScore), 0, 10) : undefined,
    riskScore: parsed.riskScore != null ? clamp(Number(parsed.riskScore), 0, 10) : undefined,
    riskFlags: Array.isArray(parsed.riskFlags)
      ? parsed.riskFlags.map((x: any) => String(x)).slice(0, 12)
      : undefined,
    hasViralMoment: typeof parsed.hasViralMoment === 'boolean' ? parsed.hasViralMoment : undefined,
    confidence: parsed.confidence != null ? clamp(Number(parsed.confidence), 0, 1) : undefined,
    rationale: String(parsed.rationale || '').slice(0, 400),
    _cost: costMeta,
  };
}

/**
 * Download the full source video once per request (caller should cache per feedVideo).
 */
export async function ensureLocalVideoForScoring(params: {
  s3Url: string;
  cacheKey: string;
}): Promise<string> {
  const { s3Url, cacheKey } = params;
  const outPath = path.join('/tmp', `gemini-source-${cacheKey}.mp4`);
  try {
    await fs.access(outPath);
    return outPath;
  } catch {
    // continue
  }
  await downloadToTmp(s3Url, outPath);
  return outPath;
}
