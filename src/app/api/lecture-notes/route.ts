import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { badRequest, ok, serverError, unauthorized } from '@shared/lib/api-response';
import { prisma } from '@shared/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SlideNote = {
  index: number;
  timestampS: number;
  timestampLabel: string;
  title: string;
  body: string;
  rawText: string;
};

type FrameSample = {
  frameIndex: number;
  framePath: string;
  timestampS: number;
  timestampLabel: string;
};

type ExtractResult = {
  notes: SlideNote[];
  durationS: number;
  sampledFrameCount: number;
  providerUsed: 'gemini' | 'ollama' | 'ocr';
  modelUsed: string | null;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
  };
  fallbackUsed: boolean;
};

const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;
const DEFAULT_INTERVAL_SECONDS = 8;
const MAX_INTERVAL_SECONDS = 30;
const MIN_INTERVAL_SECONDS = 2;
const MAX_FRAMES_FOR_LLM = 30;

function runCommand(
  command: string,
  args: string[],
  options?: { cwd?: string }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options?.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (error) => reject(error));
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}: ${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function cleanOcrText(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeForSimilarity(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function jaccardSimilarity(a: string, b: string): number {
  const aTokens = new Set(normalizeForSimilarity(a));
  const bTokens = new Set(normalizeForSimilarity(b));
  if (aTokens.size === 0 && bTokens.size === 0) return 1;
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1;
  }
  const union = aTokens.size + bTokens.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function pickSlideTitle(cleanedText: string, fallbackLabel: string): string {
  const lines = cleanedText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return fallbackLabel;

  const firstMeaningfulLine =
    lines.find((line) => line.length >= 4 && line.length <= 120) ?? lines[0] ?? fallbackLabel;
  return firstMeaningfulLine.slice(0, 120);
}

function escapeLatex(input: string): string {
  return input
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([#$%&_{}])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}');
}

function toMarkdown(notes: SlideNote[], sourceFilename: string): string {
  const now = new Date().toISOString();
  const lines: string[] = [
    '---',
    `title: ${sourceFilename.replace(/\.[^.]+$/, '')}`,
    'tags: [lecture, slides, notes]',
    `generated: ${now}`,
    '---',
    '',
    '# Lecture Notes',
    '',
  ];

  for (const note of notes) {
    lines.push(`## ${note.title}`);
    lines.push(`- Timestamp: ${note.timestampLabel}`);
    lines.push('');
    lines.push(note.body);
    lines.push('');
  }

  return lines.join('\n').trim();
}

function toPlainText(notes: SlideNote[], sourceFilename: string): string {
  const lines: string[] = [`Lecture Notes: ${sourceFilename}`, ''];
  for (const note of notes) {
    lines.push(`${note.title} (${note.timestampLabel})`);
    lines.push(note.body);
    lines.push('');
  }
  return lines.join('\n').trim();
}

function toLatex(notes: SlideNote[], sourceFilename: string): string {
  const title = escapeLatex(sourceFilename.replace(/\.[^.]+$/, ''));
  const lines: string[] = [
    '\\documentclass{article}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{hyperref}',
    '\\begin{document}',
    `\\title{${title} Notes}`,
    '\\author{Lecture OCR Export}',
    '\\date{}',
    '\\maketitle',
    '',
  ];

  for (const note of notes) {
    lines.push(`\\section*{${escapeLatex(note.title)}}`);
    lines.push(`\\textbf{Timestamp}: ${escapeLatex(note.timestampLabel)}\\\\`);
    lines.push(escapeLatex(note.body).replace(/\n/g, '\n\n'));
    lines.push('');
  }

  lines.push('\\end{document}');
  return lines.join('\n').trim();
}

function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1];
  return text;
}

function parseJsonObject(text: string): any | null {
  const cleaned = stripCodeFences(text);
  const startObj = cleaned.indexOf('{');
  const endObj = cleaned.lastIndexOf('}');
  if (startObj !== -1 && endObj !== -1) {
    try {
      return JSON.parse(cleaned.slice(startObj, endObj + 1));
    } catch {
      // try array parsing below
    }
  }

  const startArray = cleaned.indexOf('[');
  const endArray = cleaned.lastIndexOf(']');
  if (startArray !== -1 && endArray !== -1) {
    try {
      return { notes: JSON.parse(cleaned.slice(startArray, endArray + 1)) };
    } catch {
      return null;
    }
  }
  return null;
}

function dedupeAndReindexNotes(notes: SlideNote[]): SlideNote[] {
  const deduped: SlideNote[] = [];
  for (const candidate of notes) {
    const signature = `${candidate.title}\n${candidate.body}`;
    const duplicate = deduped.some((existing) => {
      const existingSignature = `${existing.title}\n${existing.body}`;
      const similarity = jaccardSimilarity(existingSignature, signature);
      return similarity >= 0.84;
    });
    if (!duplicate) {
      deduped.push(candidate);
    }
  }

  return deduped
    .sort((a, b) => a.timestampS - b.timestampS)
    .map((note, idx) => ({
      ...note,
      index: idx + 1,
      timestampLabel: formatTimestamp(note.timestampS),
    }));
}

async function ensureExecutable(command: string): Promise<boolean> {
  try {
    await runCommand('bash', ['-lc', `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

async function probeDurationS(videoPath: string): Promise<number> {
  const { stdout } = await runCommand('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    videoPath,
  ]);
  const parsed = Number.parseFloat(stdout.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

async function extractSampledFrames(
  videoPath: string,
  intervalSeconds: number,
  tmpDir: string
): Promise<{ frames: FrameSample[]; durationS: number; sampledFrameCount: number }> {
  const framesDir = path.join(tmpDir, 'frames');
  await fs.mkdir(framesDir, { recursive: true });

  await runCommand('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    videoPath,
    '-vf',
    `fps=1/${intervalSeconds},scale='min(1600,iw)':-2`,
    '-q:v',
    '3',
    path.join(framesDir, 'slide_%05d.jpg'),
  ]);

  const allFrameFiles = (await fs.readdir(framesDir))
    .filter((name) => name.endsWith('.jpg'))
    .sort((a, b) => a.localeCompare(b));

  if (!allFrameFiles.length) {
    return { frames: [], durationS: 0, sampledFrameCount: 0 };
  }

  const stride = Math.max(1, Math.ceil(allFrameFiles.length / MAX_FRAMES_FOR_LLM));
  const selectedFrames: FrameSample[] = [];
  for (let i = 0; i < allFrameFiles.length; i += stride) {
    const framePath = path.join(framesDir, allFrameFiles[i] ?? '');
    const timestampS = i * intervalSeconds;
    selectedFrames.push({
      frameIndex: selectedFrames.length + 1,
      framePath,
      timestampS,
      timestampLabel: formatTimestamp(timestampS),
    });
  }

  const durationS = await probeDurationS(videoPath);
  return { frames: selectedFrames, durationS, sampledFrameCount: selectedFrames.length };
}

async function extractOcrTexts(
  frames: FrameSample[]
): Promise<Array<FrameSample & { ocrRaw: string; ocrClean: string }>> {
  const withText: Array<FrameSample & { ocrRaw: string; ocrClean: string }> = [];
  for (const frame of frames) {
    const { stdout } = await runCommand('tesseract', [
      frame.framePath,
      'stdout',
      '-l',
      'eng',
      '--psm',
      '6',
    ]);
    withText.push({
      ...frame,
      ocrRaw: stdout.trim(),
      ocrClean: cleanOcrText(stdout),
    });
  }
  return withText;
}

function buildNotesFromOcr(
  frames: Array<FrameSample & { ocrRaw: string; ocrClean: string }>
): SlideNote[] {
  const notes: SlideNote[] = [];
  let lastKeptText = '';

  for (const frame of frames) {
    if (frame.ocrClean.length < 35) continue;

    const similarity = jaccardSimilarity(lastKeptText, frame.ocrClean);
    if (similarity >= 0.78) continue;

    notes.push({
      index: notes.length + 1,
      timestampS: frame.timestampS,
      timestampLabel: frame.timestampLabel,
      title: pickSlideTitle(frame.ocrClean, `Slide ${notes.length + 1}`),
      body: frame.ocrClean,
      rawText: frame.ocrRaw,
    });
    lastKeptText = frame.ocrClean;
  }

  return dedupeAndReindexNotes(notes);
}

async function extractWithGemini(
  frames: Array<FrameSample & { base64: string }>,
  modelName?: string
): Promise<{
  notes: SlideNote[];
  modelUsed: string;
  usage?: { inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number };
}> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY is missing for Gemini lecture extraction');
  }

  const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  const chosenRaw = modelName || process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const chosenModel = chosenRaw.startsWith('models/') ? chosenRaw : `models/${chosenRaw}`;
  const prompt = `You are extracting lecture slide notes from a sequence of video frames.

Return ONLY valid JSON with this shape:
{
  "notes": [
    {
      "frameIndex": 1,
      "timestampS": 8,
      "title": "Slide title",
      "body": "Main slide text as markdown bullets when appropriate."
    }
  ]
}

Rules:
- Deduplicate repeated slides and only keep unique slides.
- Preserve technical text, equations, and bullet hierarchy when visible.
- Use concise slide titles (max 120 chars).
- If text is unclear, omit that slide instead of hallucinating.
- Keep notes ordered by time.`;

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
    { text: prompt },
  ];
  for (const frame of frames) {
    parts.push({
      text: `Frame ${frame.frameIndex} at ${frame.timestampLabel} (${frame.timestampS.toFixed(1)}s)`,
    });
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: frame.base64,
      },
    });
  }

  const response = await fetch(
    `${baseUrl}/${chosenModel}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  const bodyText = await response.text();
  let data: any;
  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new Error(`Gemini returned non-JSON response (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(`Gemini extraction failed (${response.status}): ${JSON.stringify(data)}`);
  }

  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part?.text)
      .filter(Boolean)
      .join('') ?? '';
  const parsed = parseJsonObject(text);
  if (!parsed || !Array.isArray(parsed.notes)) {
    throw new Error('Gemini response did not include parseable notes JSON');
  }

  const notes = parsed.notes
    .map((note: any, idx: number) => {
      const frameIdxRaw = Number(note.frameIndex);
      const frame = frames.find((f) => f.frameIndex === frameIdxRaw);
      const timestampS = Number.isFinite(Number(note.timestampS))
        ? Number(note.timestampS)
        : (frame?.timestampS ?? idx * DEFAULT_INTERVAL_SECONDS);
      const body = cleanOcrText(String(note.body || note.text || '').trim());
      if (body.length < 24) return null;
      const title = pickSlideTitle(String(note.title || '').trim() || body, `Slide ${idx + 1}`);

      return {
        index: idx + 1,
        timestampS,
        timestampLabel: formatTimestamp(timestampS),
        title,
        body,
        rawText: body,
      } satisfies SlideNote;
    })
    .filter(Boolean) as SlideNote[];

  const usageMetadata = data?.usageMetadata;
  return {
    notes: dedupeAndReindexNotes(notes),
    modelUsed: chosenModel,
    usage: {
      inputTokens: usageMetadata?.promptTokenCount,
      outputTokens: usageMetadata?.candidatesTokenCount,
      estimatedCostUsd:
        usageMetadata?.promptTokenCount && usageMetadata?.candidatesTokenCount
          ? (usageMetadata.promptTokenCount / 1_000_000) * 0.075 +
            (usageMetadata.candidatesTokenCount / 1_000_000) * 0.3
          : undefined,
    },
  };
}

async function extractWithOllama(
  frameOcr: Array<FrameSample & { ocrRaw: string; ocrClean: string }>,
  modelName?: string
): Promise<{
  notes: SlideNote[];
  modelUsed: string;
  usage?: { inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number };
}> {
  const host = (
    process.env.OLLAMA_BASE_URL ||
    process.env.OLLAMA_HOST ||
    'http://localhost:11434'
  ).replace(/\/$/, '');
  const model = modelName || process.env.OLLAMA_MODEL || 'llama3';
  const slidesText = frameOcr
    .map(
      (frame) =>
        `Frame ${frame.frameIndex} | ${frame.timestampLabel} (${frame.timestampS.toFixed(1)}s)\n${frame.ocrClean}`
    )
    .join('\n\n---\n\n');

  const prompt = `You are converting OCR'd lecture slides into clean notes.

Return ONLY valid JSON:
{
  "notes": [
    {
      "frameIndex": 1,
      "timestampS": 8,
      "title": "Slide title",
      "body": "Readable notes in markdown-friendly plain text."
    }
  ]
}

Rules:
- Keep only unique slides (remove duplicates).
- Ignore OCR noise and gibberish.
- Preserve meaningful equations and bullet structure.
- Keep notes in time order.

OCR INPUT:
${slidesText}`;

  const response = await fetch(`${host}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: 'json',
      options: { temperature: 0.1 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama extraction failed (${response.status})`);
  }

  const data = (await response.json()) as any;
  const parsed = parseJsonObject(String(data.response || ''));
  if (!parsed || !Array.isArray(parsed.notes)) {
    throw new Error('Ollama response did not include parseable notes JSON');
  }

  const notes = parsed.notes
    .map((note: any, idx: number) => {
      const frameIdxRaw = Number(note.frameIndex);
      const frame = frameOcr.find((f) => f.frameIndex === frameIdxRaw);
      const timestampS = Number.isFinite(Number(note.timestampS))
        ? Number(note.timestampS)
        : (frame?.timestampS ?? idx * DEFAULT_INTERVAL_SECONDS);
      const body = cleanOcrText(String(note.body || note.text || '').trim());
      if (body.length < 24) return null;
      const title = pickSlideTitle(String(note.title || '').trim() || body, `Slide ${idx + 1}`);

      return {
        index: idx + 1,
        timestampS,
        timestampLabel: formatTimestamp(timestampS),
        title,
        body,
        rawText: frame?.ocrRaw || body,
      } satisfies SlideNote;
    })
    .filter(Boolean) as SlideNote[];

  return {
    notes: dedupeAndReindexNotes(notes),
    modelUsed: model,
    usage: {
      inputTokens: data.prompt_eval_count,
      outputTokens: data.eval_count,
      estimatedCostUsd: 0,
    },
  };
}

function resolveRequestedProvider(
  providerRaw: FormDataEntryValue | null
): 'auto' | 'gemini' | 'ollama' | 'ocr' {
  const value = String(providerRaw || 'auto').toLowerCase();
  if (value === 'gemini' || value === 'ollama' || value === 'ocr') return value;
  return 'auto';
}

function resolveProvider(
  provider: 'auto' | 'gemini' | 'ollama' | 'ocr'
): 'gemini' | 'ollama' | 'ocr' {
  if (provider !== 'auto') return provider;
  if (process.env.GOOGLE_API_KEY) return 'gemini';
  if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST) return 'ollama';
  return 'ocr';
}

async function persistLectureTrainingExample(input: {
  userId: string;
  jobId: string;
  provider: string;
  model: string | null;
  sourceFilename: string;
  frameIntervalS: number;
  sampledFrameCount: number;
  extractedSlideCount: number;
  inputPayload: Record<string, any>;
  outputPayload: Record<string, any>;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  durationMs?: number;
}) {
  try {
    await prisma.lectureTrainingExample.create({
      data: {
        userId: input.userId,
        jobId: input.jobId,
        provider: input.provider,
        model: input.model,
        sourceFilename: input.sourceFilename,
        frameIntervalS: input.frameIntervalS,
        sampledFrameCount: input.sampledFrameCount,
        extractedSlideCount: input.extractedSlideCount,
        input: input.inputPayload,
        output: input.outputPayload,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        estimatedCostUsd: input.estimatedCostUsd ?? null,
        durationMs: input.durationMs ?? null,
      },
    });
  } catch (error) {
    console.error('Failed to persist lecture training example (non-fatal):', error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorized();

    const hasFfmpeg = await ensureExecutable('ffmpeg');
    const hasFfprobe = await ensureExecutable('ffprobe');
    if (!hasFfmpeg || !hasFfprobe) {
      return serverError(
        'Lecture notes extraction requires ffmpeg and ffprobe installed on the server.'
      );
    }

    const formData = await req.formData();
    const file = formData.get('file');
    const intervalRaw = formData.get('intervalSeconds');
    const providerRaw = formData.get('provider');
    const modelNameRaw = formData.get('modelName');

    if (!(file instanceof File)) {
      return badRequest('Missing video file');
    }
    if (!file.type.startsWith('video/')) {
      return badRequest('Uploaded file must be a video');
    }
    if (file.size <= 0) {
      return badRequest('Uploaded file is empty');
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return badRequest(
        `Video exceeds ${(MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0)}MB limit`
      );
    }

    const intervalParsed = Number.parseInt(String(intervalRaw ?? ''), 10);
    const intervalSeconds = Number.isFinite(intervalParsed)
      ? Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, intervalParsed))
      : DEFAULT_INTERVAL_SECONDS;
    const requestedProvider = resolveRequestedProvider(providerRaw);
    const modelName = String(modelNameRaw || '').trim() || undefined;

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `lecture-notes-${randomUUID()}-`));
    try {
      const extension = file.name.includes('.') ? file.name.split('.').pop() : 'mp4';
      const tempVideoPath = path.join(tmpDir, `input.${extension}`);
      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(tempVideoPath, buffer);

      const sampled = await extractSampledFrames(tempVideoPath, intervalSeconds, tmpDir);
      if (!sampled.frames.length) {
        return badRequest('No frames were extracted from the video.');
      }

      const resolved = resolveProvider(requestedProvider);
      let providerUsed: 'gemini' | 'ollama' | 'ocr' = resolved;
      let fallbackUsed = false;
      let notes: SlideNote[] = [];
      let usage: ExtractResult['usage'];
      let modelUsed: string | null = null;
      const startedAt = Date.now();

      if (resolved === 'gemini') {
        try {
          const geminiFrames = await Promise.all(
            sampled.frames.map(async (frame) => {
              const frameBuffer = await fs.readFile(frame.framePath);
              return {
                ...frame,
                base64: frameBuffer.toString('base64'),
              };
            })
          );
          const gemini = await extractWithGemini(geminiFrames, modelName);
          notes = gemini.notes;
          modelUsed = gemini.modelUsed;
          usage = gemini.usage;
        } catch (error) {
          if (requestedProvider === 'gemini') throw error;
          fallbackUsed = true;
          providerUsed = 'ocr';
        }
      }

      if (providerUsed === 'ollama') {
        const hasTesseract = await ensureExecutable('tesseract');
        if (!hasTesseract) {
          if (requestedProvider === 'ollama') {
            return serverError(
              'Ollama lecture extraction requires tesseract OCR to preprocess slides.'
            );
          }
          fallbackUsed = true;
          providerUsed = 'ocr';
        } else {
          try {
            const frameOcr = await extractOcrTexts(sampled.frames);
            const ollama = await extractWithOllama(frameOcr, modelName);
            notes = ollama.notes;
            modelUsed = ollama.modelUsed;
            usage = ollama.usage;
          } catch (error) {
            if (requestedProvider === 'ollama') throw error;
            fallbackUsed = true;
            providerUsed = 'ocr';
          }
        }
      }

      if (providerUsed === 'ocr') {
        const hasTesseract = await ensureExecutable('tesseract');
        if (!hasTesseract) {
          return serverError('OCR lecture extraction requires tesseract installed on the server.');
        }
        const frameOcr = await extractOcrTexts(sampled.frames);
        notes = buildNotesFromOcr(frameOcr);
      }

      if (!notes.length) {
        return badRequest(
          'No slide text was detected. Try a lecture video with clearer slide text or lower frame interval.'
        );
      }

      const markdown = toMarkdown(notes, file.name);
      const latex = toLatex(notes, file.name);
      const text = toPlainText(notes, file.name);
      const durationMs = Date.now() - startedAt;
      const trainingJobId = randomUUID();

      await persistLectureTrainingExample({
        userId: user.id,
        jobId: trainingJobId,
        provider: providerUsed,
        model: modelUsed,
        sourceFilename: file.name,
        frameIntervalS: intervalSeconds,
        sampledFrameCount: sampled.sampledFrameCount,
        extractedSlideCount: notes.length,
        inputPayload: {
          providerRequested: requestedProvider,
          intervalSeconds,
          durationS: sampled.durationS,
          frames: sampled.frames.map((frame) => ({
            frameIndex: frame.frameIndex,
            timestampS: frame.timestampS,
            timestampLabel: frame.timestampLabel,
          })),
        },
        outputPayload: {
          notes,
          outputs: { markdown, latex, text },
          fallbackUsed,
        },
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        estimatedCostUsd: usage?.estimatedCostUsd,
        durationMs,
      });

      return ok({
        sourceFilename: file.name,
        intervalSeconds,
        sampledFrameCount: sampled.sampledFrameCount,
        extractedSlideCount: notes.length,
        durationS: sampled.durationS,
        notes,
        providerRequested: requestedProvider,
        providerUsed,
        modelUsed,
        fallbackUsed,
        trainingJobId,
        usage: usage || null,
        outputs: {
          markdown,
          latex,
          text,
        },
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  } catch (error) {
    console.error('[POST /api/lecture-notes]', error);
    return serverError('Failed to extract lecture notes', error);
  }
}
