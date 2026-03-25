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

// Path to the rembg script — in Docker it's at /app/scripts/, locally relative to repo root
const REMBG_SCRIPT =
  process.env.REMBG_SCRIPT_PATH ||
  (fs.existsSync('/app/scripts/remove_background.py')
    ? '/app/scripts/remove_background.py'
    : path.join(process.cwd(), '..', '..', 'scripts', 'remove_background.py'));

export interface ThumbnailResult {
  s3Key: string;
  s3Url: string;
  hookText: string;
  frameTimestampS: number;
}

export interface GenerateThumbnailsOptions {
  compositionId: string;
  /** S3 URL of the landscape rendered output */
  landscapeS3Url: string;
  /** S3 URL of the creator's original video */
  creatorS3Url: string;
  /** Creator trim start (to extract a representative frame) */
  creatorTrimStartS?: number;
  /** Full transcript text for hook text generation */
  transcript?: string | null;
}

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

    // 2. Get video duration
    const durationS = await getVideoDuration(landscapePath);
    if (durationS <= 0) {
      console.warn('[thumbnailGenerator] Could not determine video duration');
      return [];
    }

    // 3. Extract evenly-spaced frames from the landscape render
    const framePaths = await extractFrames(landscapePath, durationS, NUM_FRAMES, tmpDir);
    if (framePaths.length === 0) {
      console.warn('[thumbnailGenerator] No frames extracted');
      return [];
    }

    // 4. Extract a creator frame and remove background
    const creatorFrameTs = opts.creatorTrimStartS || 1;
    const creatorFramePath = path.join(tmpDir, 'creator_frame.png');
    await extractFrame(creatorPath, creatorFrameTs, creatorFramePath);

    let creatorCutoutPath: string | null = null;
    if (fs.existsSync(creatorFramePath)) {
      creatorCutoutPath = await removeBackground(
        creatorFramePath,
        path.join(tmpDir, 'creator_cutout.png')
      );
    }

    // 5. Generate hook text from transcript via Ollama (non-fatal)
    const hookText = opts.transcript ? await generateHookText(opts.transcript) : null;

    // 6. Composite each frame into a thumbnail and upload
    for (const { framePath, timestampS } of framePaths) {
      try {
        const outPath = path.join(tmpDir, `thumb_${timestampS.toFixed(1)}.png`);
        await compositeThumbnail(framePath, creatorCutoutPath, hookText, outPath);

        if (!fs.existsSync(outPath)) continue;

        // Upload to S3
        const s3Key = `compositions/${opts.compositionId}/thumbnails/${randomUUID()}.png`;
        await uploadToS3(outPath, s3Key, 'image/png');

        results.push({
          s3Key,
          s3Url: `https://${getBucket()}.s3.${getRegion()}.amazonaws.com/${s3Key}`,
          hookText: hookText || '',
          frameTimestampS: timestampS,
        });
      } catch (err) {
        console.warn(
          `[thumbnailGenerator] Failed to composite frame at ${timestampS}s:`,
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
    const proc = spawn('python3', [REMBG_SCRIPT, inputPath, outputPath], {
      timeout: 60_000, // 60s timeout
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
  const configuredBaseUrl = (process.env.OLLAMA_BASE_URL || '').replace(/\/$/, '');
  const dockerServiceDefault = 'http://ollama:11434';
  const baseUrl = configuredBaseUrl || dockerServiceDefault;
  const model = process.env.OLLAMA_MODEL || 'llama3';

  const prompt = `You are a YouTube thumbnail copywriter. Given the following video transcript, generate ONE short, punchy hook phrase (3-6 words, ALL CAPS) that would grab attention as thumbnail text. Return ONLY the phrase, nothing else.

Transcript (first 500 chars):
${transcript.slice(0, 500)}`;

  try {
    const nodeFetch = require('node-fetch');
    const res = await nodeFetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
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
 * Composite a thumbnail: background frame + creator cutout (bottom-right) + hook text (top-left).
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

    // Scale creator to ~40% of canvas height, position bottom-right
    const creatorH = Math.round(THUMBNAIL_HEIGHT * 0.4);
    filterParts.push(
      `[1:v]scale=-1:${creatorH}:flags=lanczos[creator]`,
      `[${lastLabel}][creator]overlay=W-w-24:H-h-24[composited]`
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
