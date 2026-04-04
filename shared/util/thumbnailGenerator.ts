import { spawn } from 'child_process';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

// Lazy S3 init (same pattern as reactionCompose.ts)
let _s3: S3Client | null = null;
function getS3() {
  if (!_s3) {
    const region = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-2';
    _s3 = new S3Client({ region });
  }
  return _s3;
}
function getBucket() {
  return process.env.S3_BUCKET || 'clips-genie-uploads';
}
function getRegion() {
  return process.env.S3_REGION || process.env.AWS_REGION || 'us-east-2';
}

const THUMBNAIL_WIDTH = 1280;
const THUMBNAIL_HEIGHT = 720;
const NUM_FRAMES = 6;
const MAX_CANDIDATES = 20;

// Path to the rembg script — in Docker it's at /app/scripts/, locally relative to repo root
const REMBG_SCRIPT =
  process.env.REMBG_SCRIPT_PATH ||
  (fs.existsSync('/app/scripts/remove_background.py')
    ? '/app/scripts/remove_background.py'
    : path.join(process.cwd(), '..', '..', 'scripts', 'remove_background.py'));

// Resolve python binary — prefer the venv with rembg installed, fall back to system python3
function getRembgPython(): string {
  if (process.env.REMBG_PYTHON_PATH) return process.env.REMBG_PYTHON_PATH;

  // Check for venv next to the script
  const scriptDir = path.dirname(REMBG_SCRIPT);
  const venvPython = path.join(scriptDir, '.venv', 'bin', 'python3');
  if (fs.existsSync(venvPython)) return venvPython;

  // Docker: rembg is installed system-wide
  return 'python3';
}

export interface ThumbnailResult {
  s3Key: string;
  s3Url: string;
  frameTimestampS: number;
  visionScore?: number;
}

export interface ThumbnailAssetResult {
  s3Key: string;
  s3Url: string;
  frameTimestampS: number;
  visionScore?: number;
  type: 'reference' | 'cutout';
}

export interface PreExtractedFrame {
  s3Url: string;
  timestampS: number;
}

export interface GenerateThumbnailsOptions {
  compositionId: string;
  /** S3 URL of the reference (original content) video — used as background frames */
  referenceS3Url: string;
  /** S3 URL of the creator's original video — cutout overlaid on top */
  creatorS3Url: string;
  /** Creator trim start (to extract a representative frame) */
  creatorTrimStartS?: number;
  /** Total creator video duration (for best-frame extraction) */
  creatorDurationS?: number;
  /**
   * Pre-extracted reference frame images already on S3.
   * When provided, skips downloading the reference video and FFmpeg extraction.
   * The face detection + moondream scoring pipeline still runs on these frames.
   */
  preExtractedReferenceFrames?: PreExtractedFrame[];
  /**
   * Pre-extracted creator frame images already on S3.
   * When provided, skips downloading the creator video and FFmpeg extraction.
   * The face detection + moondream + rembg pipeline still runs on these frames.
   */
  preExtractedCreatorFrames?: PreExtractedFrame[];
}

// ---------------------------------------------------------------------------
// Ollama config helpers
// ---------------------------------------------------------------------------

function getOllamaConfig() {
  const configuredBaseUrl = (process.env.OLLAMA_BASE_URL || '').replace(/\/$/, '');
  const dockerServiceDefault = 'http://ollama:11434';
  const baseUrl = configuredBaseUrl || dockerServiceDefault;
  const textModel = process.env.OLLAMA_MODEL || 'llama3';
  const visionModel = process.env.OLLAMA_VISION_MODEL || 'moondream';
  return { baseUrl, textModel, visionModel };
}

let _visionAvailable: boolean | null = null;
let _visionCheckedAt = 0;
const VISION_CACHE_MS = 60_000;

async function isOllamaVisionAvailable(): Promise<boolean> {
  if (_visionAvailable !== null && Date.now() - _visionCheckedAt < VISION_CACHE_MS) {
    return _visionAvailable;
  }

  const { baseUrl, visionModel } = getOllamaConfig();
  try {
    const nodeFetch = require('node-fetch');
    const res = await nodeFetch(`${baseUrl}/api/tags`, { timeout: 5000 });
    if (!res.ok) {
      _visionAvailable = false;
      _visionCheckedAt = Date.now();
      return false;
    }
    const data = await res.json();
    const models: Array<{ name: string }> = data.models || [];
    _visionAvailable = models.some(
      (m) => m.name === visionModel || m.name.startsWith(`${visionModel}:`)
    );
    _visionCheckedAt = Date.now();
    console.log(
      `[thumbnailGenerator] LLaVA vision available: ${_visionAvailable} (models: ${models.map((m) => m.name).join(', ')})`
    );
    return _visionAvailable;
  } catch {
    _visionAvailable = false;
    _visionCheckedAt = Date.now();
    return false;
  }
}

// ---------------------------------------------------------------------------
// Frame extraction
// ---------------------------------------------------------------------------

/**
 * Extract candidate frames using FFmpeg scene detection + evenly-spaced fill.
 * Returns up to `max` frames sorted by timestamp.
 */
async function extractCandidateFrames(
  videoPath: string,
  durationS: number,
  max: number,
  outDir: string
): Promise<Array<{ framePath: string; timestampS: number }>> {
  const results: Array<{ framePath: string; timestampS: number }> = [];

  // Phase 1: Scene detection frames (~9 targets)
  const sceneTarget = Math.min(max - Math.floor(max / 3), 9);
  try {
    const sceneFrames = await extractSceneFrames(videoPath, durationS, sceneTarget, outDir);
    for (const f of sceneFrames) {
      results.push(f);
    }
    console.log(`[thumbnailGenerator] Scene detection found ${sceneFrames.length} frames`);
  } catch (err) {
    console.warn(
      '[thumbnailGenerator] Scene detection failed (non-fatal):',
      err instanceof Error ? err.message : err
    );
  }

  // Phase 2: Fill remaining slots with evenly-spaced frames (skip timestamps near existing ones)
  const remaining = max - results.length;
  if (remaining > 0) {
    const step = durationS / (remaining + 1);
    for (let i = 1; i <= remaining; i++) {
      const ts = step * i;
      // Skip if too close to an existing frame (within 1.5s)
      if (results.some((r) => Math.abs(r.timestampS - ts) < 1.5)) continue;

      const framePath = path.join(outDir, `fill_${i}.png`);
      try {
        await extractFrame(videoPath, ts, framePath);
        if (fs.existsSync(framePath)) {
          results.push({ framePath, timestampS: ts });
        }
      } catch {
        // Non-fatal
      }
    }
  }

  results.sort((a, b) => a.timestampS - b.timestampS);
  return results.slice(0, max);
}

/**
 * Extract frames at scene change points using FFmpeg's scene detection filter.
 */
async function extractSceneFrames(
  videoPath: string,
  durationS: number,
  maxFrames: number,
  outDir: string
): Promise<Array<{ framePath: string; timestampS: number }>> {
  return new Promise((resolve) => {
    // Use scene detection to find timestamps, then extract frames at those points
    const proc = spawn('ffmpeg', [
      '-i',
      videoPath,
      '-vf',
      `select='gt(scene,0.3)',showinfo`,
      '-vsync',
      'vfr',
      '-frames:v',
      String(maxFrames),
      '-f',
      'null',
      '-',
    ]);

    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', async () => {
      // Parse timestamps from showinfo output
      const timestamps: number[] = [];
      const regex = /pts_time:(\d+\.?\d*)/g;
      let match;
      while ((match = regex.exec(stderr)) !== null) {
        const ts = parseFloat(match[1]);
        if (ts > 0.5 && ts < durationS - 0.5) {
          timestamps.push(ts);
        }
      }

      // Extract actual frames at detected timestamps
      const results: Array<{ framePath: string; timestampS: number }> = [];
      for (let i = 0; i < Math.min(timestamps.length, maxFrames); i++) {
        const ts = timestamps[i];
        const framePath = path.join(outDir, `scene_${i}.png`);
        try {
          await extractFrame(videoPath, ts, framePath);
          if (fs.existsSync(framePath)) {
            results.push({ framePath, timestampS: ts });
          }
        } catch {
          // Non-fatal
        }
      }
      resolve(results);
    });
    proc.on('error', () => resolve([]));
  });
}

// ---------------------------------------------------------------------------
// Face detection (OpenCV — fast, ~10ms per frame) + Vision scoring (moondream — slow, emotional detail)
// ---------------------------------------------------------------------------

// Path to the face detection script
const FACE_DETECT_SCRIPT =
  process.env.FACE_DETECT_SCRIPT_PATH ||
  (fs.existsSync('/app/scripts/detect_faces.py')
    ? '/app/scripts/detect_faces.py'
    : path.join(process.cwd(), '..', '..', 'scripts', 'detect_faces.py'));

interface FaceDetectResult {
  face_count: number;
  face_area_pct: number;
  largest_face_pct: number;
}

/**
 * Fast face detection using OpenCV Haar cascade (~10ms per frame).
 * Returns null on failure (non-fatal).
 */
async function detectFaces(framePath: string): Promise<FaceDetectResult | null> {
  const python = getRembgPython();
  return new Promise((resolve) => {
    const proc = spawn(python, [FACE_DETECT_SCRIPT, framePath], { timeout: 10_000 });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code !== 0) {
        console.warn(`[thumbnailGenerator] Face detection failed: ${stderr.trim()}`);
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        resolve(null);
      }
    });
    proc.on('error', () => resolve(null));
  });
}

interface VisionScoreResult {
  score: number;
  facePresence: number;
  emotionalExpression: number;
  eyeContact: number;
  visualInterest: number;
}

/**
 * Score a single frame with moondream vision model for emotional detail.
 * Only called for frames that already passed face detection.
 * Returns null on failure (non-fatal).
 */
async function scoreFrameWithVision(framePath: string): Promise<VisionScoreResult | null> {
  const { baseUrl, visionModel } = getOllamaConfig();
  try {
    const imageData = fs.readFileSync(framePath);
    const base64 = imageData.toString('base64');

    const nodeFetch = require('node-fetch');
    const res = await nodeFetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: visionModel,
        prompt:
          'Describe this image in detail. Focus on: Are there any people visible? Are they looking directly at the camera (eye contact) or looking away? What are their facial expressions and emotions? Are they surprised, excited, angry, laughing, shocked, or showing strong reactions? How visually interesting or dramatic is the scene?',
        images: [base64],
        stream: false,
        options: { temperature: 0.2, num_predict: 150 },
      }),
      timeout: 120_000, // 120s — generous for CPU inference
    });

    if (!res.ok) return null;

    const data = await res.json();
    const text = (data.response || '').trim().toLowerCase();
    console.log(`[thumbnailGenerator] Vision description: ${text.slice(0, 120)}...`);

    const emotionalExpression = scoreKeywords(text, [
      'surprised',
      'shock',
      'excited',
      'angry',
      'laughing',
      'laugh',
      'scream',
      'yelling',
      'crying',
      'smile',
      'smiling',
      'grin',
      'emotion',
      'expressive',
      'intense',
      'dramatic',
      'reaction',
      'open mouth',
      'wide eyes',
      'amazed',
      'furious',
      'outrage',
      'joy',
      'fear',
      'disbelief',
      'passionate',
      'animated',
    ]);
    const eyeContact = scoreKeywords(text, [
      'looking at the camera',
      'looking directly',
      'looking at the viewer',
      'looking at us',
      'looking straight',
      'eye contact',
      'staring at',
      'facing the camera',
      'gazing at the camera',
      'directly at',
      'into the camera',
      'toward the camera',
      'toward the viewer',
    ]);
    const visualInterest = scoreKeywords(text, [
      'dramatic',
      'dynamic',
      'interesting',
      'colorful',
      'vivid',
      'action',
      'movement',
      'gesture',
      'pointing',
      'hands',
      'close-up',
      'closeup',
      'bright',
      'contrast',
      'striking',
    ]);

    // Weight: 50% emotion, 30% eye contact, 20% visual interest
    const score = emotionalExpression * 0.5 + eyeContact * 0.3 + visualInterest * 0.2;

    return {
      score: clamp(score, 0, 10),
      facePresence: 10, // Already confirmed by OpenCV
      emotionalExpression: clamp(emotionalExpression, 0, 10),
      eyeContact: clamp(eyeContact, 0, 10),
      visualInterest: clamp(visualInterest, 0, 10),
    };
  } catch (err) {
    console.warn(
      '[thumbnailGenerator] Vision score failed (non-fatal):',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Score text by counting keyword matches. Each match adds 2 points, capped at 10.
 */
function scoreKeywords(text: string, keywords: string[]): number {
  let hits = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) hits++;
  }
  return clamp(hits * 2, 0, 10);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Two-pass frame selection:
 * 1. Fast pass — OpenCV face detection on ALL candidates (~10ms each)
 * 2. Slow pass — moondream emotion scoring on top 3 face-containing frames
 * Falls back to face-detection-only ranking if moondream is unavailable.
 */
async function scoreAndSelectFrames(
  candidates: Array<{ framePath: string; timestampS: number }>,
  topN: number
): Promise<Array<{ framePath: string; timestampS: number; visionScore?: number }>> {
  // --- Pass 1: Fast face detection on ALL candidates ---
  console.log(`[thumbnailGenerator] Running face detection on ${candidates.length} candidates...`);
  const faceScored: Array<{
    framePath: string;
    timestampS: number;
    faceCount: number;
    faceAreaPct: number;
  }> = [];

  for (const c of candidates) {
    const result = await detectFaces(c.framePath);
    const faceCount = result?.face_count ?? 0;
    const faceAreaPct = result?.face_area_pct ?? 0;
    if (faceCount > 0) {
      console.log(
        `[thumbnailGenerator] Face detected at ${c.timestampS.toFixed(1)}s: ${faceCount} face(s), ${faceAreaPct.toFixed(1)}% area`
      );
    }
    faceScored.push({ ...c, faceCount, faceAreaPct });
  }

  // Sort by face area descending (bigger faces = better thumbnails)
  const withFaces = faceScored.filter((f) => f.faceCount > 0);
  withFaces.sort((a, b) => b.faceAreaPct - a.faceAreaPct);

  console.log(
    `[thumbnailGenerator] Face detection: ${withFaces.length}/${candidates.length} frames have faces`
  );

  // If no faces found at all, fall back to evenly-spaced
  if (withFaces.length === 0) {
    console.log('[thumbnailGenerator] No faces detected — using evenly-spaced fallback');
    if (candidates.length <= topN) return candidates;
    const step = candidates.length / topN;
    return Array.from({ length: topN }, (_, i) => candidates[Math.floor(step * i)]);
  }

  // --- Pass 2: Moondream emotion scoring on top face-containing frames ---
  const MOONDREAM_BUDGET = 3; // Only send top 3 to moondream (limits slow calls)
  const moondreamCandidates = withFaces.slice(0, MOONDREAM_BUDGET);
  const visionAvailable = await isOllamaVisionAvailable();

  if (visionAvailable) {
    console.log(
      `[thumbnailGenerator] Scoring top ${moondreamCandidates.length} face frames with moondream...`
    );
    let consecutiveFailures = 0;

    for (const c of moondreamCandidates) {
      if (consecutiveFailures >= 2) {
        console.log('[thumbnailGenerator] Moondream too slow — using face detection scores only');
        break;
      }
      const result = await scoreFrameWithVision(c.framePath);
      if (result) {
        consecutiveFailures = 0;
        // Boost face area score with emotion score from moondream
        (c as any).emotionScore = result.emotionalExpression;
        console.log(
          `[thumbnailGenerator] Emotion scored at ${c.timestampS.toFixed(1)}s: emotion=${result.emotionalExpression}, visual=${result.visualInterest}`
        );
      } else {
        consecutiveFailures++;
      }
    }
  }

  // Build final scored list: face frames first (with optional emotion boost), then non-face frames
  const finalScored: Array<{ framePath: string; timestampS: number; visionScore: number }> = [];

  for (const f of withFaces) {
    // Base score from face detection (0-10 scale based on face area percentage)
    const faceScore = clamp(f.faceAreaPct * 2, 0, 10);
    const emotionBonus = (f as any).emotionScore ? (f as any).emotionScore * 0.3 : 0;
    finalScored.push({
      framePath: f.framePath,
      timestampS: f.timestampS,
      visionScore: clamp(faceScore + emotionBonus, 0, 10),
    });
  }

  // Sort by combined score descending
  finalScored.sort((a, b) => b.visionScore - a.visionScore);
  return finalScored.slice(0, topN);
}

/**
 * Select the best creator frame using two-pass scoring:
 * 1. Fast pass — OpenCV face detection on all candidate frames
 * 2. Slow pass — moondream on the single best face frame for emotion detail
 * Falls back to a frame at 1/3 of the video duration.
 */
async function selectBestCreatorFrame(
  creatorPath: string,
  durationS: number,
  trimStartS: number,
  outDir: string
): Promise<string> {
  const effectiveStart = trimStartS || 0;
  const effectiveDuration = durationS - effectiveStart;
  const fallbackTs = effectiveStart + effectiveDuration / 3;
  const fallbackPath = path.join(outDir, 'creator_frame.png');

  // Extract 10 candidate frames from the creator video
  const numCreatorFrames = 10;
  const step = effectiveDuration / (numCreatorFrames + 1);
  const creatorFrames: Array<{ path: string; ts: number }> = [];

  for (let i = 1; i <= numCreatorFrames; i++) {
    const ts = effectiveStart + step * i;
    const framePath = path.join(outDir, `creator_candidate_${i}.png`);
    try {
      await extractFrame(creatorPath, ts, framePath);
      if (fs.existsSync(framePath)) {
        creatorFrames.push({ path: framePath, ts });
      }
    } catch {
      // Non-fatal
    }
  }

  if (creatorFrames.length === 0) {
    await extractFrame(creatorPath, fallbackTs, fallbackPath);
    return fallbackPath;
  }

  // --- Pass 1: Fast face detection on all creator frames ---
  console.log(
    `[thumbnailGenerator] Running face detection on ${creatorFrames.length} creator frames...`
  );
  const faceResults: Array<{ frame: (typeof creatorFrames)[0]; faceArea: number }> = [];

  for (const frame of creatorFrames) {
    const result = await detectFaces(frame.path);
    const faceArea = result?.face_area_pct ?? 0;
    if (faceArea > 0) {
      console.log(
        `[thumbnailGenerator] Creator face at ${frame.ts.toFixed(1)}s: ${result!.face_count} face(s), ${faceArea.toFixed(1)}% area`
      );
    }
    faceResults.push({ frame, faceArea });
  }

  // Sort by face area, pick the best
  faceResults.sort((a, b) => b.faceArea - a.faceArea);
  let bestFrame = faceResults[0].frame;

  if (faceResults[0].faceArea === 0) {
    console.log('[thumbnailGenerator] No faces in creator frames — using 1/3 duration frame');
    return creatorFrames[Math.floor(creatorFrames.length / 3)]?.path || fallbackPath;
  }

  // --- Pass 2: Moondream on top 2 face frames for emotion scoring ---
  const visionAvailable = await isOllamaVisionAvailable();
  if (visionAvailable) {
    const top2 = faceResults.filter((f) => f.faceArea > 0).slice(0, 2);
    let bestMoondreamScore = -1;

    for (const { frame } of top2) {
      const result = await scoreFrameWithVision(frame.path);
      if (result) {
        const weighted = result.emotionalExpression * 0.7 + result.visualInterest * 0.3;
        console.log(
          `[thumbnailGenerator] Creator emotion at ${frame.ts.toFixed(1)}s: emotion=${result.emotionalExpression}, weighted=${weighted.toFixed(1)}`
        );
        if (weighted > bestMoondreamScore) {
          bestMoondreamScore = weighted;
          bestFrame = frame;
        }
      } else {
        console.log(
          '[thumbnailGenerator] Moondream failed for creator — using face detection result'
        );
        break;
      }
    }
  }

  console.log(
    `[thumbnailGenerator] Best creator frame: ${bestFrame.ts.toFixed(1)}s (faceArea=${faceResults[0]?.faceArea?.toFixed(1) ?? 0}%)`
  );
  return bestFrame.path;
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/**
 * Main thumbnail generation pipeline.
 * Returns an array of thumbnail results (may be fewer than NUM_FRAMES on partial failure).
 */
export async function generateThumbnails(
  opts: GenerateThumbnailsOptions
): Promise<ThumbnailResult[]> {
  const tmpDir = path.join(os.tmpdir(), `thumb-${randomUUID()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const results: ThumbnailResult[] = [];

  try {
    // 1. Download reference video and creator video locally
    const referencePath = path.join(tmpDir, 'reference.mp4');
    const creatorPath = path.join(tmpDir, 'creator.mp4');

    await Promise.all([
      downloadFile(opts.referenceS3Url, referencePath),
      downloadFile(opts.creatorS3Url, creatorPath),
    ]);

    // 2. Get video durations
    const [referenceDuration, creatorDuration] = await Promise.all([
      getVideoDuration(referencePath),
      opts.creatorDurationS ?? getVideoDuration(creatorPath),
    ]);

    if (referenceDuration <= 0) {
      console.warn('[thumbnailGenerator] Could not determine reference video duration');
      return [];
    }

    // 3. Extract candidate frames from reference video (scene detection + evenly-spaced fill)
    const candidateFrames = await extractCandidateFrames(
      referencePath,
      referenceDuration,
      MAX_CANDIDATES,
      tmpDir
    );
    if (candidateFrames.length === 0) {
      console.warn('[thumbnailGenerator] No frames extracted from reference video');
      return [];
    }

    // 4. Score and select top 6 most emotional/expressive frames with LLaVA
    const selectedFrames = await scoreAndSelectFrames(candidateFrames, NUM_FRAMES);
    console.log(
      `[thumbnailGenerator] Selected ${selectedFrames.length} frames from ${candidateFrames.length} candidates`
    );

    // 5. Select best creator frame (most emotional) and remove background
    const bestCreatorFramePath = await selectBestCreatorFrame(
      creatorPath,
      creatorDuration,
      opts.creatorTrimStartS || 0,
      tmpDir
    );

    let creatorCutoutPath: string | null = null;
    if (fs.existsSync(bestCreatorFramePath)) {
      creatorCutoutPath = await removeBackground(
        bestCreatorFramePath,
        path.join(tmpDir, 'creator_cutout.png')
      );
    }

    // 6. Composite each reference frame + creator cutout into a thumbnail and upload
    for (const frame of selectedFrames) {
      try {
        const outPath = path.join(tmpDir, `thumb_${frame.timestampS.toFixed(1)}.png`);
        await compositeThumbnail(frame.framePath, creatorCutoutPath, outPath);

        if (!fs.existsSync(outPath)) continue;

        // Upload to S3
        const s3Key = `compositions/${opts.compositionId}/thumbnails/${randomUUID()}.png`;
        await uploadToS3(outPath, s3Key, 'image/png');

        results.push({
          s3Key,
          s3Url: `https://${getBucket()}.s3.${getRegion()}.amazonaws.com/${s3Key}`,
          frameTimestampS: frame.timestampS,
          visionScore: (frame as any).visionScore ?? undefined,
        });
      } catch (err) {
        console.warn(
          `[thumbnailGenerator] Failed to composite frame at ${frame.timestampS}s:`,
          err instanceof Error ? err.message : err
        );
        // Non-fatal — skip this frame
      }
    }

    return results;
  } finally {
    // Clean up temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Download a file from a URL to a local path.
 */
async function downloadFile(url: string, dest: string): Promise<void> {
  const nodeFetch = require('node-fetch');
  const res = await nodeFetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  const { pipeline } = await import('stream/promises');
  await pipeline(res.body, fs.createWriteStream(dest));
}

/**
 * Get video duration in seconds via ffprobe.
 */
async function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v',
      'quiet',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      videoPath,
    ]);
    let output = '';
    proc.stdout.on('data', (d) => (output += d.toString()));
    proc.on('close', (code) => {
      const dur = parseFloat(output.trim());
      resolve(code === 0 && !isNaN(dur) ? dur : 0);
    });
    proc.on('error', () => resolve(0));
  });
}

/**
 * Extract a single frame from a video at a given timestamp.
 */
export async function extractFrame(
  videoPath: string,
  timestampS: number,
  outPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-ss',
      String(timestampS),
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      outPath,
    ]);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg extractFrame exited ${code}: ${stderr.slice(-500)}`));
    });
    proc.on('error', reject);
  });
}

/**
 * Extract n evenly-spaced frames from a video.
 * Returns array of { framePath, timestampS }.
 */
export async function extractFrames(
  videoPath: string,
  durationS: number,
  n: number,
  outDir: string
): Promise<Array<{ framePath: string; timestampS: number }>> {
  const results: Array<{ framePath: string; timestampS: number }> = [];
  // Distribute frames evenly, avoiding the very start (0s) and very end
  const step = durationS / (n + 1);

  for (let i = 1; i <= n; i++) {
    const ts = step * i;
    const framePath = path.join(outDir, `frame_${i}.png`);
    try {
      await extractFrame(videoPath, ts, framePath);
      if (fs.existsSync(framePath)) {
        results.push({ framePath, timestampS: ts });
      }
    } catch (err) {
      console.warn(
        `[thumbnailGenerator] Frame extraction failed at ${ts}s:`,
        err instanceof Error ? err.message : err
      );
      // Non-fatal — skip this frame
    }
  }

  return results;
}

/**
 * Remove background from an image using the Python rembg script.
 * Returns the output path on success, or null on failure (non-fatal).
 */
export async function removeBackground(
  inputPath: string,
  outputPath: string
): Promise<string | null> {
  return new Promise((resolve) => {
    const pythonBin = getRembgPython();
    console.log(`[thumbnailGenerator] rembg using python: ${pythonBin}`);
    const proc = spawn(pythonBin, [REMBG_SCRIPT, inputPath, outputPath], {
      timeout: 300_000, // 5min timeout (first run downloads 176MB u2net model)
    });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        console.warn(`[thumbnailGenerator] rembg failed (code ${code}): ${stderr.slice(-500)}`);
        resolve(null);
      }
    });
    proc.on('error', (err) => {
      console.warn(`[thumbnailGenerator] rembg spawn error: ${err.message}`);
      resolve(null);
    });
  });
}

/**
 * Composite a thumbnail: reference frame (background) + creator cutout (center-right, 85% height).
 * Uses FFmpeg for all compositing. No text overlay.
 */
export async function compositeThumbnail(
  bgPath: string,
  creatorCutoutPath: string | null,
  outPath: string
): Promise<void> {
  const args: string[] = ['-y'];
  const filterParts: string[] = [];

  // Input 0: background frame
  args.push('-i', bgPath);

  // Scale background to thumbnail size
  filterParts.push(
    `[0:v]scale=${THUMBNAIL_WIDTH}:${THUMBNAIL_HEIGHT}:force_original_aspect_ratio=increase,crop=${THUMBNAIL_WIDTH}:${THUMBNAIL_HEIGHT}[bg]`
  );

  let lastLabel = 'bg';

  if (creatorCutoutPath && fs.existsSync(creatorCutoutPath)) {
    // Input 1: creator cutout
    args.push('-i', creatorCutoutPath);

    // Scale creator to 85% of canvas height (612px at 720p), center in right half, flush to bottom
    const creatorH = Math.round(THUMBNAIL_HEIGHT * 0.85);
    filterParts.push(
      `[1:v]scale=-1:${creatorH}:flags=lanczos[creator]`,
      `[${lastLabel}][creator]overlay=W*3/4-w/2:H-h[composited]`
    );
    lastLabel = 'composited';
  }

  // Final output mapping
  const filterComplex = filterParts.join(';');
  args.push('-filter_complex', filterComplex, '-map', `[${lastLabel}]`, '-frames:v', '1', outPath);

  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg composite exited ${code}: ${stderr.slice(-500)}`));
    });
    proc.on('error', reject);
  });
}

/**
 * Upload a local file to S3.
 */
async function uploadToS3(localPath: string, s3Key: string, contentType: string): Promise<void> {
  const fileStream = fs.createReadStream(localPath);
  const upload = new Upload({
    client: getS3(),
    params: {
      Bucket: getBucket(),
      Key: s3Key,
      Body: fileStream,
      ContentType: contentType,
    },
  });
  await upload.done();
}

// ---------------------------------------------------------------------------
// Thumbnail Builder — asset generation (worker) + sharp compositing (API)
// ---------------------------------------------------------------------------

const NUM_CUTOUT_FRAMES = 12;

/**
 * Generate raw thumbnail assets (reference frames + cutouts) without compositing.
 * Called by the worker. Returns assets to store as ThumbnailAsset records.
 */
export async function generateThumbnailAssets(
  opts: GenerateThumbnailsOptions
): Promise<{ referenceFrames: ThumbnailAssetResult[]; cutouts: ThumbnailAssetResult[] }> {
  const tmpDir = path.join(os.tmpdir(), `thumb-assets-${randomUUID()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const referenceFrames: ThumbnailAssetResult[] = [];
  const cutouts: ThumbnailAssetResult[] = [];

  try {
    const hasPreExtractedRef =
      opts.preExtractedReferenceFrames && opts.preExtractedReferenceFrames.length > 0;
    const hasPreExtractedCreator =
      opts.preExtractedCreatorFrames && opts.preExtractedCreatorFrames.length > 0;

    // 1. Download videos (only if we need FFmpeg extraction)
    let referencePath = '';
    let creatorPath = '';
    let referenceDuration = 0;
    let creatorDuration = opts.creatorDurationS ?? 0;

    if (!hasPreExtractedRef || !hasPreExtractedCreator) {
      if (!hasPreExtractedRef) {
        referencePath = path.join(tmpDir, 'reference.mp4');
        await downloadFile(opts.referenceS3Url, referencePath);
        referenceDuration = await getVideoDuration(referencePath);
      }
      if (!hasPreExtractedCreator) {
        creatorPath = path.join(tmpDir, 'creator.mp4');
        await downloadFile(opts.creatorS3Url, creatorPath);
        if (!creatorDuration) {
          creatorDuration = await getVideoDuration(creatorPath);
        }
      }
    }

    // 3. Extract + score reference frames
    let selectedRefFrames: Array<{ framePath: string; timestampS: number; visionScore?: number }>;

    if (hasPreExtractedRef) {
      // Download pre-extracted frame images from S3 to temp dir
      console.log(
        `[thumbnailAssets] Using ${opts.preExtractedReferenceFrames!.length} pre-extracted reference frames`
      );
      const candidateFrames: Array<{ framePath: string; timestampS: number }> = [];
      for (let i = 0; i < opts.preExtractedReferenceFrames!.length; i++) {
        const pf = opts.preExtractedReferenceFrames![i];
        const framePath = path.join(tmpDir, `pre_ref_${i}.png`);
        try {
          await downloadFile(pf.s3Url, framePath);
          if (fs.existsSync(framePath)) {
            candidateFrames.push({ framePath, timestampS: pf.timestampS });
          }
        } catch (err) {
          console.warn(
            `[thumbnailAssets] Failed to download pre-extracted ref frame ${i}:`,
            err instanceof Error ? err.message : err
          );
        }
      }
      selectedRefFrames = await scoreAndSelectFrames(candidateFrames, NUM_FRAMES);
    } else {
      if (referenceDuration <= 0) {
        console.warn('[thumbnailAssets] Could not determine reference video duration');
        return { referenceFrames, cutouts };
      }
      const candidateFrames = await extractCandidateFrames(
        referencePath,
        referenceDuration,
        MAX_CANDIDATES,
        tmpDir
      );
      if (candidateFrames.length === 0) {
        console.warn('[thumbnailAssets] No frames extracted from reference video');
        return { referenceFrames, cutouts };
      }
      selectedRefFrames = await scoreAndSelectFrames(candidateFrames, NUM_FRAMES);
    }

    console.log(`[thumbnailAssets] Selected ${selectedRefFrames.length} reference frames`);

    // 4. Upload raw reference frames to S3
    for (const frame of selectedRefFrames) {
      try {
        const s3Key = `compositions/${opts.compositionId}/assets/ref_${randomUUID()}.png`;
        await uploadToS3(frame.framePath, s3Key, 'image/png');
        referenceFrames.push({
          s3Key,
          s3Url: `https://${getBucket()}.s3.${getRegion()}.amazonaws.com/${s3Key}`,
          frameTimestampS: frame.timestampS,
          visionScore: (frame as any).visionScore ?? undefined,
          type: 'reference',
        });
      } catch (err) {
        console.warn(
          `[thumbnailAssets] Failed to upload ref frame at ${frame.timestampS}s:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    // 5. Extract creator candidate frames and score by face area
    const creatorFrames: Array<{ path: string; ts: number }> = [];

    if (hasPreExtractedCreator) {
      // Download pre-extracted creator frame images from S3 to temp dir
      console.log(
        `[thumbnailAssets] Using ${opts.preExtractedCreatorFrames!.length} pre-extracted creator frames`
      );
      for (let i = 0; i < opts.preExtractedCreatorFrames!.length; i++) {
        const pf = opts.preExtractedCreatorFrames![i];
        const framePath = path.join(tmpDir, `pre_creator_${i}.png`);
        try {
          await downloadFile(pf.s3Url, framePath);
          if (fs.existsSync(framePath)) {
            creatorFrames.push({ path: framePath, ts: pf.timestampS });
          }
        } catch (err) {
          console.warn(
            `[thumbnailAssets] Failed to download pre-extracted creator frame ${i}:`,
            err instanceof Error ? err.message : err
          );
        }
      }
    } else {
      const effectiveStart = opts.creatorTrimStartS || 0;
      const effectiveDuration = creatorDuration - effectiveStart;
      const numCreatorFrames = 20;
      const step = effectiveDuration / (numCreatorFrames + 1);

      for (let i = 1; i <= numCreatorFrames; i++) {
        const ts = effectiveStart + step * i;
        const framePath = path.join(tmpDir, `creator_cand_${i}.png`);
        try {
          await extractFrame(creatorPath, ts, framePath);
          if (fs.existsSync(framePath)) {
            creatorFrames.push({ path: framePath, ts });
          }
        } catch {
          // Non-fatal
        }
      }
    }

    // Face-detect all creator frames, then score top candidates with moondream for emotion
    const creatorFaceScored: Array<{
      frame: (typeof creatorFrames)[0];
      faceArea: number;
      emotionScore: number;
      combinedScore: number;
    }> = [];
    for (const frame of creatorFrames) {
      const result = await detectFaces(frame.path);
      const faceArea = result?.face_area_pct ?? 0;
      creatorFaceScored.push({ frame, faceArea, emotionScore: 0, combinedScore: faceArea });
    }

    // Sort by face area, take top candidates with faces for emotion scoring
    creatorFaceScored.sort((a, b) => b.faceArea - a.faceArea);
    const withFaces = creatorFaceScored.filter((f) => f.faceArea > 0);

    // Run moondream emotion scoring on top face-containing frames
    const EMOTION_BUDGET = Math.min(withFaces.length, 8);
    const visionAvailable = await isOllamaVisionAvailable();
    if (visionAvailable && EMOTION_BUDGET > 0) {
      console.log(
        `[thumbnailAssets] Scoring top ${EMOTION_BUDGET} creator frames with moondream for emotion...`
      );
      let consecutiveFailures = 0;
      for (let i = 0; i < EMOTION_BUDGET; i++) {
        if (consecutiveFailures >= 2) {
          console.log('[thumbnailAssets] Moondream too slow — using face detection scores only');
          break;
        }
        const visionResult = await scoreFrameWithVision(withFaces[i].frame.path);
        if (visionResult) {
          consecutiveFailures = 0;
          withFaces[i].emotionScore = visionResult.emotionalExpression;
          // Combined: 30% face area + 40% emotion + 30% eye contact
          const faceScore = clamp(withFaces[i].faceArea * 2, 0, 10);
          withFaces[i].combinedScore =
            faceScore * 0.3 +
            visionResult.emotionalExpression * 0.4 +
            visionResult.eyeContact * 0.3;
          console.log(
            `[thumbnailAssets] Creator at ${withFaces[i].frame.ts.toFixed(1)}s: emotion=${visionResult.emotionalExpression.toFixed(1)}, eye=${visionResult.eyeContact.toFixed(1)}, combined=${withFaces[i].combinedScore.toFixed(1)}`
          );
        } else {
          consecutiveFailures++;
          // Fall back to face area only
          withFaces[i].combinedScore = clamp(withFaces[i].faceArea * 2, 0, 10);
        }
      }
    }

    // Re-sort by combined score (emotion-weighted) and pick top N
    creatorFaceScored.sort((a, b) => b.combinedScore - a.combinedScore);
    const facesOnly = creatorFaceScored.filter((f) => f.faceArea > 0);
    // Fallback: if face detection failed (e.g. cv2 missing), use evenly-spaced creator frames
    let topCreatorFrames: typeof creatorFaceScored;
    if (facesOnly.length > 0) {
      topCreatorFrames = facesOnly.slice(0, NUM_CUTOUT_FRAMES);
    } else {
      console.log(
        '[thumbnailAssets] No faces detected in creator frames — using evenly-spaced fallback for cutouts'
      );
      const step = Math.max(1, Math.floor(creatorFaceScored.length / NUM_CUTOUT_FRAMES));
      topCreatorFrames = Array.from(
        { length: Math.min(NUM_CUTOUT_FRAMES, creatorFaceScored.length) },
        (_, i) => creatorFaceScored[Math.min(i * step, creatorFaceScored.length - 1)]
      );
    }

    console.log(
      `[thumbnailAssets] Top ${topCreatorFrames.length} creator frames (emotion-weighted): ${topCreatorFrames.map((f) => `${f.frame.ts.toFixed(1)}s=${f.combinedScore.toFixed(1)}`).join(', ')}`
    );

    // 6. Run rembg on each top creator frame and upload cutouts
    for (let i = 0; i < topCreatorFrames.length; i++) {
      const { frame, combinedScore } = topCreatorFrames[i];
      try {
        const cutoutPath = path.join(tmpDir, `cutout_${i}.png`);
        const result = await removeBackground(frame.path, cutoutPath);
        if (!result) continue;

        const s3Key = `compositions/${opts.compositionId}/assets/cutout_${randomUUID()}.png`;
        await uploadToS3(cutoutPath, s3Key, 'image/png');
        cutouts.push({
          s3Key,
          s3Url: `https://${getBucket()}.s3.${getRegion()}.amazonaws.com/${s3Key}`,
          frameTimestampS: frame.ts,
          visionScore: clamp(combinedScore, 0, 10),
          type: 'cutout',
        });
      } catch (err) {
        console.warn(
          `[thumbnailAssets] Failed to create cutout ${i}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    console.log(
      `[thumbnailAssets] Generated ${referenceFrames.length} reference frames + ${cutouts.length} cutouts`
    );
    return { referenceFrames, cutouts };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Composite a thumbnail using sharp (fast, ~50ms).
 * Used by the Next.js API route for instant compositing.
 *
 * @param backgroundBuffer - PNG buffer of the reference frame
 * @param cutoutBuffer - PNG buffer of the cutout (transparent background)
 * @param position - 'left' | 'right'
 * @param size - 'small' | 'medium' | 'large'
 * @returns PNG buffer of the composited thumbnail
 */
export async function compositeThumbnailSharp(
  backgroundBuffer: Buffer,
  cutoutBuffer: Buffer,
  position: 'left' | 'right' = 'right',
  size: 'small' | 'medium' | 'large' = 'large'
): Promise<Buffer> {
  const sharp = require('sharp');

  const canvasW = THUMBNAIL_WIDTH;
  const canvasH = THUMBNAIL_HEIGHT;

  // Size → height percentage of canvas
  const sizeMap: Record<string, number> = {
    small: 0.5,
    medium: 0.7,
    large: 0.85,
  };
  const targetH = Math.round(canvasH * (sizeMap[size] || 0.85));

  // Resize background to fill canvas
  const bg = sharp(backgroundBuffer).resize(canvasW, canvasH, { fit: 'cover' });

  // Resize cutout to target height, preserving aspect ratio
  const cutoutMeta = await sharp(cutoutBuffer).metadata();
  const cutoutAR = (cutoutMeta.width || 1) / (cutoutMeta.height || 1);
  const cutoutW = Math.round(targetH * cutoutAR);

  const resizedCutout = await sharp(cutoutBuffer)
    .resize(cutoutW, targetH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Position: left = W/4 - w/2, right = 3W/4 - w/2, bottom-anchored
  const xCenter = position === 'left' ? Math.round(canvasW / 4) : Math.round((3 * canvasW) / 4);
  const left = Math.max(0, Math.min(canvasW - cutoutW, xCenter - Math.round(cutoutW / 2)));
  const top = canvasH - targetH;

  const result = await bg
    .composite([{ input: resizedCutout, left, top }])
    .png()
    .toBuffer();

  return result;
}

// ---------------------------------------------------------------------------
// AI Background Generation
// ---------------------------------------------------------------------------

export type ThumbnailStyleVariant = 'cinematic' | 'vivid' | 'gradient' | 'warm';
const ALL_STYLES: ThumbnailStyleVariant[] = ['cinematic', 'vivid', 'gradient', 'warm'];

interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Detect the video player region inside a screen-recording frame.
 *
 * Two-pass edge detection:
 *
 * **Pass 1 — vertical border**: find the strongest *interior* column edge
 * (mean brightness difference × consistency). This is the right edge of the
 * video player; the left edge defaults to the frame edge (YouTube players
 * typically sit flush-left on the page).
 *
 * **Pass 2 — horizontal borders**: within the player's column range (0 to
 * right-edge), find the two strongest row edges — one above and one below 40%
 * of the frame height. Computing row edges only within the player columns
 * avoids diluting the signal with the sidebar.
 *
 * Falls back to the full frame when no strong interior column edge exists
 * (i.e. the frame is already clean video content, not a screen recording).
 */
async function identifyBestRegion(
  frameBuffer: Buffer,
  imgWidth: number,
  imgHeight: number
): Promise<CropRegion> {
  const sharp = require('sharp');
  const TARGET_AR = 16 / 9;

  // Analyse at 128-wide for speed while retaining enough detail for borders
  const AW = 128;
  const scaleX = imgWidth / AW;
  const AH = Math.round(imgHeight / scaleX);
  const scaleY = imgHeight / AH;
  const PX_THRESH = 15; // per-pixel edge must exceed this to count as "strong"

  try {
    const { data: px } = await sharp(frameBuffer)
      .resize(AW, AH, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const L = (x: number, y: number): number => {
      const i = (y * AW + x) * 3;
      return (px[i] + px[i + 1] + px[i + 2]) / 3;
    };

    // ----------------------------------------------------------------
    // PASS 1 — find strongest interior column edge (right player border)
    // ----------------------------------------------------------------
    const COL_MARGIN = Math.max(3, Math.round(AW * 0.03));
    let rightCol = -1;
    let rightColScore = 0;

    for (let x = COL_MARGIN; x < AW - COL_MARGIN; x++) {
      let sum = 0;
      let strong = 0;
      for (let y = 0; y < AH; y++) {
        const e = Math.abs(L(x, y) - L(x - 1, y));
        sum += e;
        if (e > PX_THRESH) strong++;
      }
      const combined = (sum / AH) * (strong / AH);
      if (combined > rightColScore) {
        rightColScore = combined;
        rightCol = x;
      }
    }

    // If no meaningful interior column edge → frame is clean video, no crop
    if (rightCol < 0 || rightColScore < 3) {
      console.log(
        `[thumbnailGenerator] No interior column edge found (best=${rightColScore.toFixed(1)}), using full frame`
      );
      return { x: 0, y: 0, width: imgWidth, height: imgHeight };
    }

    // Left border defaults to frame edge
    const leftCol = 0;
    const colRange = rightCol - leftCol;

    console.log(
      `[thumbnailGenerator] Pass 1 — right border: col ${rightCol} ` +
        `(x=${Math.round(rightCol * scaleX)}, ${((rightCol / AW) * 100).toFixed(0)}%) score=${rightColScore.toFixed(1)}`
    );

    // ----------------------------------------------------------------
    // PASS 2 — within cols 0..rightCol, find top & bottom row borders
    // ----------------------------------------------------------------
    const ROW_MARGIN = 2;
    interface RowEdgeResult {
      y: number;
      combined: number;
    }
    const rowResults: RowEdgeResult[] = [];

    for (let y = ROW_MARGIN; y < AH - ROW_MARGIN; y++) {
      let sum = 0;
      let strong = 0;
      for (let x = leftCol; x < rightCol; x++) {
        const e = Math.abs(L(x, y) - L(x, y - 1));
        sum += e;
        if (e > PX_THRESH) strong++;
      }
      const combined = (sum / colRange) * (strong / colRange);
      rowResults.push({ y, combined });
    }

    rowResults.sort((a, b) => b.combined - a.combined);

    const midRow = Math.round(AH * 0.4);
    const topRow = rowResults.find((r) => r.y < midRow);
    const botRow = rowResults.find((r) => r.y > midRow);

    if (!topRow || !botRow) {
      console.log('[thumbnailGenerator] Could not find top/bottom borders, using full frame');
      return { x: 0, y: 0, width: imgWidth, height: imgHeight };
    }

    console.log(
      `[thumbnailGenerator] Pass 2 — top: row ${topRow.y} (y=${Math.round(topRow.y * scaleY)}) ` +
        `score=${topRow.combined.toFixed(1)}, ` +
        `bottom: row ${botRow.y} (y=${Math.round(botRow.y * scaleY)}) ` +
        `score=${botRow.combined.toFixed(1)}`
    );

    // ----------------------------------------------------------------
    // PASS 3 — tighten left/right to actual content using brightness
    // variance. Uniform dark background (black bars, page margin) has
    // near-zero std dev; real video content has high std dev.
    // ----------------------------------------------------------------
    const nRows = botRow.y - topRow.y + 1;
    const FRAME_MARGIN = 3; // skip first/last cols (frame-edge artefacts)
    const colStdDev: number[] = [];
    for (let x = leftCol; x < rightCol; x++) {
      let sum = 0;
      for (let y = topRow.y; y <= botRow.y; y++) sum += L(x, y);
      const mean = sum / nRows;
      let sqSum = 0;
      for (let y = topRow.y; y <= botRow.y; y++) sqSum += (L(x, y) - mean) ** 2;
      colStdDev.push(Math.sqrt(sqSum / nRows));
    }

    // Content threshold: columns with std dev > 5 have real variation
    const STD_THRESH = 5;
    let contentLeft = leftCol;
    let contentRight = rightCol - 1;
    for (let i = FRAME_MARGIN; i < colStdDev.length; i++) {
      if (colStdDev[i] > STD_THRESH) {
        contentLeft = leftCol + i;
        break;
      }
    }
    for (let i = colStdDev.length - 1 - FRAME_MARGIN; i >= 0; i--) {
      if (colStdDev[i] > STD_THRESH) {
        contentRight = leftCol + i;
        break;
      }
    }

    console.log(
      `[thumbnailGenerator] Pass 3 — content cols: ${contentLeft}–${contentRight} ` +
        `(x=${Math.round(contentLeft * scaleX)}–${Math.round(contentRight * scaleX)})`
    );

    // Map to original pixel coordinates (tight content region)
    let contentX = Math.round(contentLeft * scaleX);
    let contentY = Math.round(topRow.y * scaleY);
    let contentW = Math.round((contentRight - contentLeft + 1) * scaleX);
    let contentH = Math.round((botRow.y - topRow.y) * scaleY);

    // Add 10% bottom padding to capture captions near the player border
    const bottomPad = Math.round(contentH * 0.1);
    contentH = Math.min(contentH + bottomPad, imgHeight - contentY);

    console.log(
      `[thumbnailGenerator] Content region: ${contentX},${contentY} ${contentW}x${contentH}`
    );

    // Return the tight content crop — applyThumbnailStyle handles
    // aspect-ratio mismatch by compositing sharp content over a blurred fill.
    const pct = (((contentW * contentH) / (imgWidth * imgHeight)) * 100).toFixed(0);
    console.log(
      `[thumbnailGenerator] Final crop: ${contentX},${contentY} ${contentW}x${contentH} ` +
        `ar=${(contentW / contentH).toFixed(2)} (${pct}% of ${imgWidth}x${imgHeight})`
    );

    // If the final region covers >85% of the frame, no meaningful crop
    if (contentW * contentH > imgWidth * imgHeight * 0.85) {
      console.log('[thumbnailGenerator] Content fills >85%, using full frame');
      return { x: 0, y: 0, width: imgWidth, height: imgHeight };
    }
    // <5% → detection failed
    if (contentW * contentH < imgWidth * imgHeight * 0.05) {
      console.log('[thumbnailGenerator] Detected region <5%, using full frame');
      return { x: 0, y: 0, width: imgWidth, height: imgHeight };
    }

    return { x: contentX, y: contentY, width: contentW, height: contentH };
  } catch (err) {
    console.warn(
      '[thumbnailGenerator] identifyBestRegion failed:',
      err instanceof Error ? err.message : err
    );
    return { x: 0, y: 0, width: imgWidth, height: imgHeight };
  }
}

/** Small random jitter around a base value: base ± range */
function jitter(base: number, range: number): number {
  return base + (Math.random() * 2 - 1) * range;
}

/**
 * Apply a visual enhancement style to a cropped buffer, producing a 1280×720 PNG.
 * Uses lanczos3 kernel for high-quality upscaling and applies a sharpening pass
 * after resize to restore detail lost during interpolation.
 *
 * Style parameters include randomised jitter so that regenerating the same source
 * frame produces visually distinct results each time.
 */
async function applyThumbnailStyle(
  croppedBuffer: Buffer,
  style: ThumbnailStyleVariant
): Promise<Buffer> {
  const sharp = require('sharp');
  const W = THUMBNAIL_WIDTH;
  const H = THUMBNAIL_HEIGHT;

  // Build the base image: blurred fill background + sharp content centered on top.
  // This preserves the full content (including captions) regardless of aspect ratio.
  const meta = await sharp(croppedBuffer).metadata();
  const srcW = meta.width || W;
  const srcH = meta.height || H;
  const srcAR = srcW / srcH;
  const targetAR = W / H;

  let baseBuffer: Buffer;
  if (Math.abs(srcAR - targetAR) < 0.05) {
    // AR close enough — multi-step upscale for quality
    let upscaled = croppedBuffer;
    let curW = srcW;
    let curH = srcH;
    while (curW * 2 <= W && curH * 2 <= H) {
      curW *= 2;
      curH *= 2;
      upscaled = await sharp(upscaled)
        .resize(curW, curH, { kernel: 'lanczos3' })
        .sharpen({ sigma: 0.6, m1: 1.0, m2: 0.3 })
        .png()
        .toBuffer();
    }
    baseBuffer = await sharp(upscaled)
      .resize(W, H, { fit: 'cover', kernel: 'lanczos3' })
      .sharpen({ sigma: 1.0, m1: 1.5, m2: 0.7 })
      .png()
      .toBuffer();
  } else {
    // AR mismatch — create blurred fill, then composite sharp content centered
    const blurBg = await sharp(croppedBuffer)
      .resize(W, H, { fit: 'cover', kernel: 'lanczos3' })
      .blur(25)
      .modulate({ brightness: 0.6 })
      .png()
      .toBuffer();

    // Multi-step upscale for better quality on low-res sources.
    // Upscaling in 2x increments with sharpening at each step produces
    // much crisper results than a single large jump.
    const targetH = H; // fit to height
    const targetW = Math.round(srcW * (H / srcH));
    let upscaled = croppedBuffer;
    let curW = srcW;
    let curH = srcH;
    while (curH * 2 <= targetH) {
      curW *= 2;
      curH *= 2;
      upscaled = await sharp(upscaled)
        .resize(curW, curH, { kernel: 'lanczos3' })
        .sharpen({ sigma: 0.6, m1: 1.0, m2: 0.3 })
        .png()
        .toBuffer();
    }
    // Final step to exact target size
    const contentFit = await sharp(upscaled)
      .resize(targetW, targetH, { kernel: 'lanczos3' })
      .sharpen({ sigma: 1.0, m1: 1.5, m2: 0.7 })
      .png()
      .toBuffer();

    const fitMeta = await sharp(contentFit).metadata();
    const fitW = fitMeta.width || W;
    const fitH = fitMeta.height || H;
    const left = Math.round((W - fitW) / 2);
    const top = Math.round((H - fitH) / 2);

    baseBuffer = await sharp(blurBg)
      .composite([{ input: contentFit, left, top }])
      .png()
      .toBuffer();
  }

  let pipeline = sharp(baseBuffer);

  switch (style) {
    case 'cinematic': {
      const blur = jitter(1.8, 0.6); // 1.2 – 2.4
      const brightness = jitter(1.05, 0.05);
      const saturation = jitter(1.1, 0.15);
      const gamma = jitter(1.1, 0.1);
      const vignetteOpacity = jitter(0.6, 0.15).toFixed(2);

      pipeline = pipeline
        .blur(Math.max(0.3, blur))
        .modulate({ brightness, saturation })
        .gamma(Math.max(0.8, gamma));

      const base = await pipeline.png().toBuffer();

      const vignetteSvg = Buffer.from(
        `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="v" cx="50%" cy="50%" r="70%">
              <stop offset="50%" stop-color="black" stop-opacity="0"/>
              <stop offset="100%" stop-color="black" stop-opacity="${vignetteOpacity}"/>
            </radialGradient>
          </defs>
          <rect width="${W}" height="${H}" fill="url(#v)"/>
        </svg>`
      );

      return sharp(base)
        .composite([{ input: vignetteSvg, blend: 'over' }])
        .png()
        .toBuffer();
    }

    case 'vivid': {
      const brightness = jitter(1.1, 0.08);
      const saturation = jitter(1.5, 0.2);
      const sharpenSigma = jitter(1.5, 0.5);
      const gamma = jitter(1.3, 0.15);

      return pipeline
        .modulate({ brightness, saturation })
        .sharpen({ sigma: Math.max(0.5, sharpenSigma) })
        .gamma(Math.max(0.8, gamma))
        .png()
        .toBuffer();
    }

    case 'gradient': {
      const saturation = jitter(1.2, 0.15);
      const topOpacity = jitter(0.4, 0.15).toFixed(2);
      const bottomOpacity = jitter(0.5, 0.15).toFixed(2);

      const base = await pipeline.modulate({ saturation }).png().toBuffer();

      const gradientSvg = Buffer.from(
        `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="black" stop-opacity="${topOpacity}"/>
              <stop offset="40%" stop-color="black" stop-opacity="0"/>
              <stop offset="60%" stop-color="black" stop-opacity="0"/>
              <stop offset="100%" stop-color="black" stop-opacity="${bottomOpacity}"/>
            </linearGradient>
          </defs>
          <rect width="${W}" height="${H}" fill="url(#g)"/>
        </svg>`
      );

      return sharp(base)
        .composite([{ input: gradientSvg, blend: 'over' }])
        .png()
        .toBuffer();
    }

    case 'warm': {
      const brightness = jitter(1.05, 0.05);
      const saturation = jitter(1.3, 0.15);
      const redBoost = jitter(1.1, 0.08);
      const blueShift = jitter(0.85, 0.08);

      return pipeline
        .modulate({ brightness, saturation })
        .recomb([
          [redBoost, 0.05, 0.0],
          [0.0, 1.0, 0.0],
          [0.0, 0.0, blueShift],
        ])
        .png()
        .toBuffer();
    }

    default:
      return pipeline.png().toBuffer();
  }
}

/**
 * Generate 4 AI-enhanced background variants from a reference frame buffer.
 * Uses Moondream for intelligent region selection, then Sharp for style processing.
 */
export async function generateAiBackgrounds(
  referenceFrameBuffer: Buffer
): Promise<Array<{ buffer: Buffer; style: ThumbnailStyleVariant }>> {
  const sharp = require('sharp');

  // Get source image dimensions
  const meta = await sharp(referenceFrameBuffer).metadata();
  const imgW = meta.width || THUMBNAIL_WIDTH;
  const imgH = meta.height || THUMBNAIL_HEIGHT;

  // Identify best crop region via Moondream (or fallback center crop)
  const region = await identifyBestRegion(referenceFrameBuffer, imgW, imgH);

  // Crop the region
  const croppedBuffer = await sharp(referenceFrameBuffer)
    .extract({ left: region.x, top: region.y, width: region.width, height: region.height })
    .toBuffer();

  // Apply all 4 styles in parallel
  const results = await Promise.all(
    ALL_STYLES.map(async (style) => ({
      buffer: await applyThumbnailStyle(croppedBuffer, style),
      style,
    }))
  );

  return results;
}
