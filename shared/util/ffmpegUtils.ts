import { spawn } from 'child_process';
import { PassThrough } from 'stream';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
const fetch = require('node-fetch');
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getCaptionFontSizePx, type CaptionFontSize } from '@shared/virality';

const CLIPS_BUCKET = process.env.S3_BUCKET || 'clips-genie-uploads';
const CLIPS_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';
const s3 = new S3Client({ region: CLIPS_REGION });

function parseTimeToSeconds(t: string): number {
  const [hh, mm, ss] = t.split(':').map(parseFloat);
  return hh * 3600 + mm * 60 + ss;
}

type AspectRatio = '9:16' | '16:9' | '1:1';

function getAspectRatioFilter(aspectRatio: AspectRatio = '9:16') {
  const targets: Record<AspectRatio, { w: number; h: number }> = {
    '9:16': { w: 720, h: 1280 },
    '16:9': { w: 1280, h: 720 },
    '1:1': { w: 720, h: 720 },
  };

  const { w, h } = targets[aspectRatio] ?? targets['9:16'];

  // Use "increase" (supported in ffmpeg 5.x) to cover-fit, then center crop to exact output dims.
  return `scale=${w}:${h}:force_original_aspect_ratio=increase,setsar=1,crop=${w}:${h}:(iw-${w})/2:(ih-${h})/2`;
}

function normalizeAspectRatio(aspectRatio?: string): AspectRatio {
  const allowed: AspectRatio[] = ['9:16', '16:9', '1:1'];
  return allowed.includes(aspectRatio as AspectRatio) ? (aspectRatio as AspectRatio) : '9:16';
}

export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

export type CaptionOptions = {
  enabled: boolean;
  segments: TranscriptSegment[];
  font?: string;
  fontSize?: CaptionFontSize;
};

export type ClipGenerationOptions = {
  showTimestamp?: boolean;
  captions?: CaptionOptions;
};

function generateAssSubtitles(
  segments: TranscriptSegment[],
  clipStartS: number,
  clipEndS: number,
  font: string = 'DejaVu Sans',
  fontSizePx: number = 36
): string {
  const filtered = segments.filter((seg) => seg.end > clipStartS && seg.start < clipEndS);

  const assHeader = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 720',
    'PlayResY: 1280',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${font},${fontSizePx},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,20,20,80,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events = filtered.map((seg) => {
    const relStart = Math.max(0, seg.start - clipStartS);
    const relEnd = Math.min(clipEndS - clipStartS, seg.end - clipStartS);
    const start = formatAssTime(relStart);
    const end = formatAssTime(relEnd);
    const text = seg.text.trim().replace(/\n/g, '\\N');
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
  });

  return [...assHeader, ...events, ''].join('\n');
}

function formatAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function buildTimestampFilter(startTimeStr: string): string {
  const startSeconds = parseTimeToSeconds(startTimeStr);
  const hh = Math.floor(startSeconds / 3600);
  const mm = Math.floor((startSeconds % 3600) / 60);
  const ss = Math.floor(startSeconds % 60);
  const formattedStart = `${String(hh).padStart(2, '0')}\\:${String(mm).padStart(2, '0')}\\:${String(ss).padStart(2, '0')}`;
  // Display in upper-left, fade out after 3 seconds (alpha goes to 0 between t=3 and t=4)
  return `drawtext=text='${formattedStart}':fontsize=28:fontcolor=white:borderw=2:bordercolor=black:x=20:y=20:alpha='if(lt(t\\,3)\\,1\\,if(lt(t\\,4)\\,1-(t-3)\\,0))'`;
}

export async function generateClipFromS3(
  inputPath: string,
  start: string,
  end: string,
  key: string,
  aspectRatio?: string,
  options?: ClipGenerationOptions
) {
  const duration = parseTimeToSeconds(end) - parseTimeToSeconds(start);
  const isUrl = inputPath.startsWith('http');
  const aspectRatioFilter = getAspectRatioFilter(normalizeAspectRatio(aspectRatio));

  const startSeconds = parseTimeToSeconds(start);
  const endSeconds = parseTimeToSeconds(end);

  let vf = aspectRatioFilter;
  if (options?.showTimestamp) {
    vf += ',' + buildTimestampFilter(start);
  }

  let assFilePath: string | null = null;
  if (options?.captions?.enabled && options.captions.segments.length > 0) {
    const fontSizePx = getCaptionFontSizePx(options.captions.fontSize);
    const assContent = generateAssSubtitles(
      options.captions.segments,
      startSeconds,
      endSeconds,
      options.captions.font || 'DejaVu Sans',
      fontSizePx
    );
    assFilePath = join(tmpdir(), `captions-${Date.now()}-${Math.random().toString(36).slice(2)}.ass`);
    writeFileSync(assFilePath, assContent, 'utf-8');
    const escapedPath = assFilePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    vf += `,ass='${escapedPath}'`;
  }

  const ffmpegArgs = [
    '-ss',
    start,
    '-i',
    isUrl ? 'pipe:0' : inputPath,
    '-t',
    duration.toString(),
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    '-movflags',
    'frag_keyframe+empty_moov',
    '-f',
    'mp4',
    'pipe:1',
  ];

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  let ffmpegErrorOutput = '';
  ffmpeg.stderr.on('data', (chunk) => {
    ffmpegErrorOutput += chunk.toString();
  });

  if (isUrl) {
    const inputStream = await fetch(inputPath).then((res: any) => res.body!);
    inputStream.pipe(ffmpeg.stdin!);
  }

  const outputStream = new PassThrough();
  ffmpeg.stdout.pipe(outputStream);

  const ffmpegDone = new Promise<void>((resolve, reject) => {
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (assFilePath) {
        try { unlinkSync(assFilePath); } catch {}
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${ffmpegErrorOutput}`));
      }
    });
  });

  const parallelUploads3 = new Upload({
    client: s3,
    params: {
      Bucket: CLIPS_BUCKET,
      Key: key,
      Body: outputStream,
      ContentType: 'video/mp4',
    },
  });

  await Promise.all([parallelUploads3.done(), ffmpegDone]);

  return {
    s3Key: key,
    s3Url: `https://${CLIPS_BUCKET}.s3.${CLIPS_REGION}.amazonaws.com/${key}`,
  };
}

export async function trimClipFromS3(
  inputPath: string,
  startSeconds: number,
  endSeconds: number,
  key: string
) {
  const duration = Math.max(0, endSeconds - startSeconds);
  const isUrl = inputPath.startsWith('http');

  const ffmpegArgs = [
    '-ss',
    startSeconds.toFixed(3),
    '-i',
    isUrl ? 'pipe:0' : inputPath,
    '-t',
    duration.toFixed(3),
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    '-movflags',
    'frag_keyframe+empty_moov',
    '-f',
    'mp4',
    'pipe:1',
  ];

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  let ffmpegErrorOutput = '';
  ffmpeg.stderr.on('data', (chunk) => {
    ffmpegErrorOutput += chunk.toString();
  });

  if (isUrl) {
    const inputStream = await fetch(inputPath).then((res: any) => res.body!);
    inputStream.pipe(ffmpeg.stdin!);
  }

  const outputStream = new PassThrough();
  ffmpeg.stdout.pipe(outputStream);

  const ffmpegDone = new Promise<void>((resolve, reject) => {
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${ffmpegErrorOutput}`));
      }
    });
  });

  const parallelUploads3 = new Upload({
    client: s3,
    params: {
      Bucket: CLIPS_BUCKET,
      Key: key,
      Body: outputStream,
      ContentType: 'video/mp4',
    },
  });

  await Promise.all([parallelUploads3.done(), ffmpegDone]);

  return {
    s3Key: key,
    s3Url: `https://${CLIPS_BUCKET}.s3.${CLIPS_REGION}.amazonaws.com/${key}`,
  };
}
