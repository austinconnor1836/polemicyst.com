import { spawn } from 'child_process';
import { PassThrough } from 'stream';
const fetch = require('node-fetch');
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

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

export type ClipGenerationOptions = {
  showTimestamp?: boolean;
};

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

  let vf = aspectRatioFilter;
  if (options?.showTimestamp) {
    vf += ',' + buildTimestampFilter(start);
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
