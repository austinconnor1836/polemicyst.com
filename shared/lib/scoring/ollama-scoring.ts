const fetch = require('node-fetch');
import { spawn } from 'child_process';
import type { LLMScoreResult } from './llm-types';

type TargetPlatform = 'all' | 'reels' | 'shorts' | 'youtube';
type ContentStyle = 'politics' | 'comedy' | 'education' | 'podcast' | 'gaming' | 'vlog' | 'other';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function coerceScore(value: unknown, fallback: number): number {
  const num = Number(value);
  if (Number.isFinite(num)) {
    return clamp(num, 0, 10);
  }
  return fallback;
}

function coerceBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function coerceArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? v : String(v))).filter((v) => v.length);
  }
  return [];
}

async function runFfmpegAndCapture(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
    });
  });
}

async function computeAudioStats(params: {
  videoPath: string;
  tStartS: number;
  duration: number;
}): Promise<{ meanVolume: number | null; maxVolume: number | null; silenceRatio: number | null }> {
  const { videoPath, tStartS, duration } = params;
  try {
    const volLog = await runFfmpegAndCapture([
      '-hide_banner',
      '-ss',
      `${tStartS}`,
      '-t',
      `${duration}`,
      '-i',
      videoPath,
      '-vn',
      '-af',
      'volumedetect',
      '-f',
      'null',
      '-',
    ]);
    const meanMatch = volLog.match(/mean_volume:\s*([-\d.]+)\s*dB/);
    const maxMatch = volLog.match(/max_volume:\s*([-\d.]+)\s*dB/);
    const meanVolume = meanMatch ? Number(meanMatch[1]) : null;
    const maxVolume = maxMatch ? Number(maxMatch[1]) : null;

    const silenceLog = await runFfmpegAndCapture([
      '-hide_banner',
      '-ss',
      `${tStartS}`,
      '-t',
      `${duration}`,
      '-i',
      videoPath,
      '-vn',
      '-af',
      'silencedetect=noise=-35dB:d=0.2',
      '-f',
      'null',
      '-',
    ]);

    let silenceDur = 0;
    const silenceMatches = silenceLog.match(/silence_duration:\s*([-\d.]+)/g) || [];
    silenceMatches.forEach((entry) => {
      const m = entry.match(/silence_duration:\s*([-\d.]+)/);
      if (m) silenceDur += Number(m[1]) || 0;
    });
    const silenceRatio = duration > 0 ? clamp(silenceDur / duration, 0, 1) : null;

    return { meanVolume, maxVolume, silenceRatio };
  } catch {
    return { meanVolume: null, maxVolume: null, silenceRatio: null };
  }
}

async function computeVisualStats(params: {
  videoPath: string;
  tStartS: number;
  duration: number;
}): Promise<{ avgBrightness: number | null; sceneChanges: number | null }> {
  const { videoPath, tStartS, duration } = params;
  try {
    const brightnessLog = await runFfmpegAndCapture([
      '-hide_banner',
      '-ss',
      `${tStartS}`,
      '-t',
      `${duration}`,
      '-i',
      videoPath,
      '-vf',
      'signalstats',
      '-f',
      'null',
      '-',
    ]);
    const brightnessMatches = brightnessLog.match(/YAVG=([\d.]+)/g) || [];
    const brightnessValues = brightnessMatches.map((entry) => {
      const m = entry.match(/YAVG=([\d.]+)/);
      return m ? Number(m[1]) : null;
    });
    const avgBrightness =
      brightnessValues.length > 0
        ? brightnessValues
            .filter((n): n is number => Number.isFinite(n))
            .reduce((a, b) => a + b, 0) / brightnessValues.length
        : null;

    const sceneLog = await runFfmpegAndCapture([
      '-hide_banner',
      '-ss',
      `${tStartS}`,
      '-t',
      `${duration}`,
      '-i',
      videoPath,
      '-vf',
      'select=gt(scene\\,0.3),metadata=print',
      '-an',
      '-f',
      'null',
      '-',
    ]);
    const sceneMatches = sceneLog.match(/scene_score=([\d.]+)/g) || [];
    const sceneChanges = sceneMatches.length;

    return { avgBrightness, sceneChanges };
  } catch {
    return { avgBrightness: null, sceneChanges: null };
  }
}

export async function summarizeSegmentMedia(params: {
  videoPath: string;
  tStartS: number;
  tEndS: number;
  includeAudio?: boolean;
}): Promise<string | null> {
  const { videoPath, tStartS, tEndS, includeAudio } = params;
  const duration = Math.max(0.5, tEndS - tStartS);
  const lines: string[] = [];

  if (includeAudio) {
    const audio = await computeAudioStats({ videoPath, tStartS, duration });
    if (audio.meanVolume !== null || audio.maxVolume !== null || audio.silenceRatio !== null) {
      lines.push(
        `Audio cues: mean volume ${audio.meanVolume?.toFixed(1) ?? 'N/A'} dB, max ${
          audio.maxVolume?.toFixed(1) ?? 'N/A'
        } dB, silence ratio ${audio.silenceRatio !== null ? audio.silenceRatio.toFixed(2) : 'N/A'}.`
      );
    }
  }

  const visual = await computeVisualStats({ videoPath, tStartS, duration });
  if (visual.avgBrightness !== null || visual.sceneChanges !== null) {
    lines.push(
      `Visual cues: avg brightness ${visual.avgBrightness !== null ? visual.avgBrightness.toFixed(0) : 'N/A'} (0-255), scene changes ${visual.sceneChanges ?? 'N/A'}.`
    );
  }

  if (!lines.length) return null;
  return lines.join(' ');
}

export async function scoreSegmentWithOllama(params: {
  transcriptText: string;
  tStartS: number;
  tEndS: number;
  targetPlatform?: TargetPlatform;
  contentStyle?: ContentStyle;
  saferClips?: boolean;
  mediaSummary?: string | null;
}): Promise<LLMScoreResult> {
  const {
    transcriptText,
    tStartS,
    tEndS,
    targetPlatform = 'all',
    contentStyle,
    saferClips = false,
    mediaSummary,
  } = params;

  // Keep prompts small for local models. Default to 4000 chars; override with OLLAMA_MAX_TRANSCRIPT_CHARS.
  const maxTranscriptChars = Number(process.env.OLLAMA_MAX_TRANSCRIPT_CHARS) || 4000;
  const trimmedTranscript =
    transcriptText.length > maxTranscriptChars
      ? `${transcriptText.slice(0, maxTranscriptChars)}...`
      : transcriptText;

  // Default to the docker service name so containers resolve correctly even if
  // OLLAMA_BASE_URL is not provided via env.
  const configuredBaseUrl = (process.env.OLLAMA_BASE_URL || '').replace(/\/$/, '');
  const localDefault = 'http://127.0.0.1:11434'; // works for host-installed Ollama
  const dockerServiceDefault = 'http://ollama:11434'; // works inside docker-compose network when env is unset
  let baseUrl = configuredBaseUrl || localDefault;
  const model = process.env.OLLAMA_MODEL || 'llama3';

  const prompt = [
    `You are a ruthless short-form video editor optimizing for virality on ${targetPlatform}.`,
    contentStyle ? `Content style: ${contentStyle}.` : '',
    saferClips
      ? `Safety mode: ON. Downrank risky segments. Prefer accurate, context-complete clips that minimize defamation/misinformation risk.`
      : `Safety mode: OFF. Focus purely on virality.`,
    mediaSummary ? `Approximate media cues (derived offline): ${mediaSummary}` : '',
    `Window: start=${tStartS.toFixed(2)}s end=${tEndS.toFixed(2)}s`,
    `Transcript (may be truncated): """${trimmedTranscript}"""`,
    '',
    `Return ONLY valid JSON with this shape:`,
    `{"score":0-10,"hookScore":0-10,"contextScore":0-10,"captionabilityScore":0-10,"comedicScore":0-10,"provocativeScore":0-10,"visualEnergyScore":0-10,"audioEnergyScore":0-10,"riskScore":0-10,"riskFlags":["..."],"hasViralMoment":true/false,"confidence":0-1,"rationale":"..."}`,
    `Rules:`,
    `- All scores must be numbers in the given ranges.`,
    `- riskFlags must be a JSON array (can be empty).`,
    `- rationale <= 2 sentences.`,
    `- Respond with JSON only.`,
  ]
    .filter(Boolean)
    .join('\n');

  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    console.log(`[ollama] still scoring model=${model} elapsedMs=${elapsed}`);
  }, 15_000);
  console.log(
    `[ollama] scoring start model=${model} window=${tStartS.toFixed(2)}-${tEndS.toFixed(
      2
    )} transcriptChars=${trimmedTranscript.length}`
  );
  let res;
  try {
    try {
      res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: { temperature: 0.2 },
        }),
      });
    } catch (err) {
      // If no explicit base URL is configured, fall back to the docker service name.
      if (!configuredBaseUrl && baseUrl !== dockerServiceDefault) {
        baseUrl = dockerServiceDefault;
        res = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            prompt,
            stream: false,
            options: { temperature: 0.2 },
          }),
        });
      } else {
        throw err;
      }
    }
  } finally {
    clearInterval(heartbeat);
  }

  const data = await res.json();
  if (!res.ok) {
    console.error(
      `[ollama] scoring error status=${res.status} durationMs=${Date.now() - startedAt} body=${JSON.stringify(
        data
      )}`
    );
    throw new Error(
      `Ollama scoring error (${res.status}): ${typeof data === 'string' ? data : JSON.stringify(data)}`
    );
  }

  const rawText = (data?.response ?? '').toString();
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Ollama returned non-JSON response: ${rawText.slice(0, 200)}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawText.slice(start, end + 1));
  } catch (err) {
    console.error(
      `[ollama] scoring parse error durationMs=${Date.now() - startedAt} raw=${rawText.slice(0, 200)}`
    );
    throw new Error(`Failed to parse Ollama JSON: ${(err as Error).message}`);
  }

  const score = coerceScore(parsed.score, 0);

  const result = {
    score,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
    hookScore: coerceScore(parsed.hookScore, score),
    contextScore: coerceScore(parsed.contextScore, score),
    captionabilityScore: coerceScore(parsed.captionabilityScore, score),
    comedicScore: coerceScore(parsed.comedicScore, score),
    provocativeScore: coerceScore(parsed.provocativeScore, score),
    visualEnergyScore: coerceScore(parsed.visualEnergyScore, score),
    audioEnergyScore: coerceScore(parsed.audioEnergyScore, score),
    riskScore: coerceScore(parsed.riskScore, 0),
    riskFlags: coerceArray(parsed.riskFlags),
    hasViralMoment: coerceBool(parsed.hasViralMoment, score >= 6),
    confidence: clamp(Number(parsed.confidence) || 0, 0, 1),
  };

  console.log(
    `[ollama] scoring success model=${model} durationMs=${Date.now() - startedAt} score=${result.score} hook=${result.hookScore} ctx=${result.contextScore}`
  );

  return result;
}
