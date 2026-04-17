import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { badRequest, ok, serverError, unauthorized } from '@shared/lib/api-response';

type SlideNote = {
  index: number;
  timestampS: number;
  timestampLabel: string;
  title: string;
  body: string;
  rawText: string;
};

type ExtractResult = {
  notes: SlideNote[];
  durationS: number;
  sampledFrameCount: number;
};

const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;
const DEFAULT_INTERVAL_SECONDS = 8;
const MAX_INTERVAL_SECONDS = 30;
const MIN_INTERVAL_SECONDS = 2;

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

async function extractNotesFromSlides(
  videoPath: string,
  intervalSeconds: number,
  tmpDir: string
): Promise<ExtractResult> {
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

  const frameFiles = (await fs.readdir(framesDir))
    .filter((name) => name.endsWith('.jpg'))
    .sort((a, b) => a.localeCompare(b));

  const notes: SlideNote[] = [];
  let lastKeptText = '';

  for (let i = 0; i < frameFiles.length; i += 1) {
    const frame = frameFiles[i];
    const framePath = path.join(framesDir, frame);
    const { stdout } = await runCommand('tesseract', [
      framePath,
      'stdout',
      '-l',
      'eng',
      '--psm',
      '6',
    ]);
    const cleaned = cleanOcrText(stdout);

    if (cleaned.length < 35) continue;

    const similarity = jaccardSimilarity(lastKeptText, cleaned);
    if (similarity >= 0.78) continue;

    const timestampS = i * intervalSeconds;
    const timestampLabel = formatTimestamp(timestampS);
    const title = pickSlideTitle(cleaned, `Slide ${notes.length + 1}`);

    notes.push({
      index: notes.length + 1,
      timestampS,
      timestampLabel,
      title,
      body: cleaned,
      rawText: stdout.trim(),
    });
    lastKeptText = cleaned;
  }

  const durationS = await probeDurationS(videoPath);
  return {
    notes,
    durationS,
    sampledFrameCount: frameFiles.length,
  };
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorized();

    const hasFfmpeg = await ensureExecutable('ffmpeg');
    const hasFfprobe = await ensureExecutable('ffprobe');
    const hasTesseract = await ensureExecutable('tesseract');

    if (!hasFfmpeg || !hasFfprobe || !hasTesseract) {
      return serverError(
        'Lecture notes extraction requires ffmpeg, ffprobe, and tesseract installed on the server.'
      );
    }

    const formData = await req.formData();
    const file = formData.get('file');
    const intervalRaw = formData.get('intervalSeconds');

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

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `lecture-notes-${randomUUID()}-`));
    try {
      const extension = file.name.includes('.') ? file.name.split('.').pop() : 'mp4';
      const tempVideoPath = path.join(tmpDir, `input.${extension}`);
      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(tempVideoPath, buffer);

      const extraction = await extractNotesFromSlides(tempVideoPath, intervalSeconds, tmpDir);
      if (!extraction.notes.length) {
        return badRequest(
          'No slide text was detected. Try a lecture video with clearer slide text or reduce the frame interval.'
        );
      }

      const markdown = toMarkdown(extraction.notes, file.name);
      const latex = toLatex(extraction.notes, file.name);
      const text = toPlainText(extraction.notes, file.name);

      return ok({
        sourceFilename: file.name,
        intervalSeconds,
        sampledFrameCount: extraction.sampledFrameCount,
        extractedSlideCount: extraction.notes.length,
        durationS: extraction.durationS,
        notes: extraction.notes,
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
