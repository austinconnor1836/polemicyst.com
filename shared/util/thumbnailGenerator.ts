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
const MAX_CANDIDATES = 15;

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
  hookText: string;
  frameTimestampS: number;
  visionScore?: number;
}

export interface GenerateThumbnailsOptions {
  compositionId: string;
  /** S3 URL of the landscape rendered output */
  landscapeS3Url: string;
  /** S3 URL of the creator's original video */
  creatorS3Url: string;
  /** Creator trim start (to extract a representative frame) */
  creatorTrimStartS?: number;
  /** Total creator video duration (for best-frame extraction) */
  creatorDurationS?: number;
  /** Full transcript text for hook text generation */
  transcript?: string | null;
}

// ---------------------------------------------------------------------------
// Ollama config helpers
// ---------------------------------------------------------------------------

function getOllamaConfig() {
  const configuredBaseUrl = (process.env.OLLAMA_BASE_URL || '').replace(/\/$/, '');
  const dockerServiceDefault = 'http://ollama:11434';
  const baseUrl = configuredBaseUrl || dockerServiceDefault;
  const textModel = process.env.OLLAMA_MODEL || 'llama3';
  const visionModel = process.env.OLLAMA_VISION_MODEL || 'llava';
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
// LLaVA vision scoring
// ---------------------------------------------------------------------------

interface VisionScoreResult {
  score: number;
  facePresence: number;
  emotionalExpression: number;
  visualInterest: number;
}

/**
 * Score a single frame with LLaVA for thumbnail quality.
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
          'Score this video frame for YouTube thumbnail quality. Return ONLY JSON: {"score": 0-10, "facePresence": 0-10, "emotionalExpression": 0-10, "visualInterest": 0-10}. Score higher for: visible human faces, strong emotions (surprise, outrage, excitement), dynamic scenes.',
        images: [base64],
        stream: false,
        format: 'json',
        options: { temperature: 0.2, num_predict: 100 },
      }),
      timeout: 20_000,
    });

    if (!res.ok) return null;

    const data = await res.json();
    const text = (data.response || '').trim();

    // Try to parse JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      score: clamp(parsed.score ?? 5, 0, 10),
      facePresence: clamp(parsed.facePresence ?? 5, 0, 10),
      emotionalExpression: clamp(parsed.emotionalExpression ?? 5, 0, 10),
      visualInterest: clamp(parsed.visualInterest ?? 5, 0, 10),
    };
  } catch (err) {
    console.warn(
      '[thumbnailGenerator] LLaVA score failed (non-fatal):',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Score all candidate frames with LLaVA and select the top N.
 * Falls back to evenly-spaced selection if LLaVA is unavailable.
 */
async function scoreAndSelectFrames(
  candidates: Array<{ framePath: string; timestampS: number }>,
  topN: number
): Promise<Array<{ framePath: string; timestampS: number; visionScore?: number }>> {
  const visionAvailable = await isOllamaVisionAvailable();

  if (!visionAvailable || candidates.length <= topN) {
    // Fallback: evenly-spaced selection
    if (candidates.length <= topN) return candidates;
    const step = candidates.length / topN;
    return Array.from({ length: topN }, (_, i) => candidates[Math.floor(step * i)]);
  }

  // Score in batches of 3 for parallelism
  const scored: Array<{ framePath: string; timestampS: number; visionScore: number }> = [];
  const BATCH_SIZE = 3;

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (c) => {
        const result = await scoreFrameWithVision(c.framePath);
        const score = result ? result.score : -1;
        if (result) {
          console.log(
            `[thumbnailGenerator] LLaVA scored frame at ${c.timestampS.toFixed(1)}s: score=${result.score}, face=${result.facePresence}, emotion=${result.emotionalExpression}`
          );
        }
        return { ...c, visionScore: score };
      })
    );
    scored.push(...batchResults);
  }

  // If all scores failed, fall back to evenly-spaced
  const validScored = scored.filter((s) => s.visionScore >= 0);
  if (validScored.length === 0) {
    const step = candidates.length / topN;
    return Array.from({ length: topN }, (_, i) => candidates[Math.floor(step * i)]);
  }

  // Sort by score descending, take top N
  validScored.sort((a, b) => b.visionScore - a.visionScore);
  return validScored.slice(0, topN);
}

/**
 * Select the best creator frame for the thumbnail using LLaVA.
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

  // Extract 5 candidate frames from the creator video
  const numCreatorFrames = 5;
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
    // Last resort fallback
    await extractFrame(creatorPath, fallbackTs, fallbackPath);
    return fallbackPath;
  }

  const visionAvailable = await isOllamaVisionAvailable();
  if (!visionAvailable) {
    // Return the frame at ~1/3 of the video
    return creatorFrames[Math.floor(creatorFrames.length / 3)]?.path || fallbackPath;
  }

  // Score each creator frame
  let bestFrame = creatorFrames[0];
  let bestScore = -1;

  for (const frame of creatorFrames) {
    const result = await scoreFrameWithVision(frame.path);
    if (result) {
      // Weight face presence heavily for creator frames
      const weighted =
        result.facePresence * 0.5 + result.emotionalExpression * 0.3 + result.score * 0.2;
      if (weighted > bestScore) {
        bestScore = weighted;
        bestFrame = frame;
      }
      console.log(
        `[thumbnailGenerator] Creator frame at ${frame.ts.toFixed(1)}s: face=${result.facePresence}, emotion=${result.emotionalExpression}, weighted=${weighted.toFixed(1)}`
      );
    }
  }

  console.log(
    `[thumbnailGenerator] Best creator frame: ${bestFrame.ts.toFixed(1)}s (score=${bestScore.toFixed(1)})`
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
    // 1. Download landscape render and creator video locally
    const landscapePath = path.join(tmpDir, 'landscape.mp4');
    const creatorPath = path.join(tmpDir, 'creator.mp4');

    await Promise.all([
      downloadFile(opts.landscapeS3Url, landscapePath),
      downloadFile(opts.creatorS3Url, creatorPath),
    ]);

    // 2. Get video durations
    const [landscapeDuration, creatorDuration] = await Promise.all([
      getVideoDuration(landscapePath),
      opts.creatorDurationS ?? getVideoDuration(creatorPath),
    ]);

    if (landscapeDuration <= 0) {
      console.warn('[thumbnailGenerator] Could not determine video duration');
      return [];
    }

    // 3. Extract candidate frames (scene detection + evenly-spaced fill)
    const candidateFrames = await extractCandidateFrames(
      landscapePath,
      landscapeDuration,
      MAX_CANDIDATES,
      tmpDir
    );
    if (candidateFrames.length === 0) {
      console.warn('[thumbnailGenerator] No frames extracted');
      return [];
    }

    // 4. Score and select top frames with LLaVA
    const selectedFrames = await scoreAndSelectFrames(candidateFrames, NUM_FRAMES);
    console.log(
      `[thumbnailGenerator] Selected ${selectedFrames.length} frames from ${candidateFrames.length} candidates`
    );

    // 5. Select best creator frame and remove background
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

    // 6. Generate hook text from transcript via Ollama (non-fatal)
    const hookText = opts.transcript ? await generateHookText(opts.transcript) : null;

    // 7. Composite each frame into a thumbnail and upload
    for (const frame of selectedFrames) {
      try {
        const outPath = path.join(tmpDir, `thumb_${frame.timestampS.toFixed(1)}.png`);
        await compositeThumbnail(frame.framePath, creatorCutoutPath, hookText, outPath);

        if (!fs.existsSync(outPath)) continue;

        // Upload to S3
        const s3Key = `compositions/${opts.compositionId}/thumbnails/${randomUUID()}.png`;
        await uploadToS3(outPath, s3Key, 'image/png');

        results.push({
          s3Key,
          s3Url: `https://${getBucket()}.s3.${getRegion()}.amazonaws.com/${s3Key}`,
          hookText: hookText || '',
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
 * Generate a short hook phrase from a transcript using Ollama.
 * Returns null if Ollama is unavailable or fails (non-fatal).
 */
export async function generateHookText(transcript: string): Promise<string | null> {
  const { baseUrl, textModel } = getOllamaConfig();

  const prompt = `You are a YouTube thumbnail copywriter. Given the following video transcript, generate ONE short, punchy hook phrase (3-6 words, ALL CAPS) that would grab attention as thumbnail text. Return ONLY the phrase, nothing else.

Transcript (first 500 chars):
${transcript.slice(0, 500)}`;

  try {
    const nodeFetch = require('node-fetch');
    const res = await nodeFetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: textModel,
        prompt,
        stream: false,
        options: { temperature: 0.8, num_predict: 30 },
      }),
      timeout: 15_000,
    });

    if (!res.ok) {
      console.warn(`[thumbnailGenerator] Ollama returned ${res.status}`);
      return null;
    }

    const data = await res.json();
    const response = (data.response || '').trim();
    // Clean up: remove quotes, take first line, limit length
    const cleaned = response
      .replace(/^["']|["']$/g, '')
      .split('\n')[0]
      .trim()
      .toUpperCase()
      .slice(0, 40);

    return cleaned || null;
  } catch (err) {
    console.warn(
      '[thumbnailGenerator] Ollama hook text failed (non-fatal):',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Composite a thumbnail: background frame + creator cutout (center-right, 85% height) + hook text (top-left).
 * Uses FFmpeg for all compositing.
 */
export async function compositeThumbnail(
  bgPath: string,
  creatorCutoutPath: string | null,
  hookText: string | null,
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

  if (hookText) {
    // Escape special characters for FFmpeg drawtext
    const escapedText = hookText
      .replace(/\\/g, '\\\\\\\\')
      .replace(/'/g, "\\'")
      .replace(/:/g, '\\:')
      .replace(/%/g, '%%');

    filterParts.push(
      `[${lastLabel}]drawtext=text='${escapedText}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:fontsize=56:fontcolor=white:borderw=4:bordercolor=black:x=40:y=40[textout]`
    );
    lastLabel = 'textout';
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
