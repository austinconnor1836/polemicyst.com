import { spawn } from 'child_process';
import { PassThrough } from 'stream';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
const fetch = require('node-fetch');
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { KeepSegment } from '@shared/lib/pause-removal';

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

export async function generateClipFromS3(
  inputPath: string,
  start: string,
  end: string,
  key: string,
  aspectRatio?: string
) {
  const duration = parseTimeToSeconds(end) - parseTimeToSeconds(start);
  const isUrl = inputPath.startsWith('http');
  const aspectRatioFilter = getAspectRatioFilter(normalizeAspectRatio(aspectRatio));

  const ffmpegArgs = [
    '-ss',
    start,
    '-i',
    isUrl ? 'pipe:0' : inputPath,
    '-t',
    duration.toString(),
    '-vf',
    aspectRatioFilter,
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

  const clipUpload = new Upload({
    client: s3,
    params: {
      Bucket: CLIPS_BUCKET,
      Key: key,
      Body: outputStream,
      ContentType: 'video/mp4',
    },
  });

  await Promise.all([clipUpload.done(), ffmpegDone]);

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

  const trimUpload = new Upload({
    client: s3,
    params: {
      Bucket: CLIPS_BUCKET,
      Key: key,
      Body: outputStream,
      ContentType: 'video/mp4',
    },
  });

  await Promise.all([trimUpload.done(), ffmpegDone]);

  return {
    s3Key: key,
    s3Url: `https://${CLIPS_BUCKET}.s3.${CLIPS_REGION}.amazonaws.com/${key}`,
  };
}

/**
 * Stitch together the "keep" segments of a video (removing pauses) and
 * upload the result to S3.
 *
 * Uses FFmpeg's concat demuxer with intermediate MPEG-TS segment files.
 */
export async function removePausesAndUpload(
  inputPath: string,
  keepSegments: KeepSegment[],
  key: string
): Promise<{ s3Key: string; s3Url: string }> {
  if (keepSegments.length === 0) {
    throw new Error('No segments to keep — refusing to produce an empty video');
  }

  const tmpDir = path.join(process.cwd(), 'tmp', `pr-${randomUUID()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const segmentFiles: string[] = [];
    for (let i = 0; i < keepSegments.length; i++) {
      const seg = keepSegments[i];
      const segFile = path.join(tmpDir, `seg_${i.toString().padStart(4, '0')}.ts`);
      segmentFiles.push(segFile);

      await new Promise<void>((resolve, reject) => {
        const args = [
          '-y',
          '-ss', seg.start.toFixed(3),
          '-i', inputPath,
          '-t', (seg.end - seg.start).toFixed(3),
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          '-f', 'mpegts',
          segFile,
        ];
        const proc = spawn('ffmpeg', args);
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg segment ${i} failed (exit ${code}): ${stderr}`));
        });
      });
    }

    const concatListPath = path.join(tmpDir, 'concat.txt');
    const concatContent = segmentFiles.map((f) => `file '${f}'`).join('\n');
    fs.writeFileSync(concatListPath, concatContent);

    const ffmpegArgs = [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-movflags', 'frag_keyframe+empty_moov',
      '-f', 'mp4',
      'pipe:1',
    ];

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    let ffmpegErrorOutput = '';
    ffmpeg.stderr.on('data', (chunk) => {
      ffmpegErrorOutput += chunk.toString();
    });

    const outputStream = new PassThrough();
    ffmpeg.stdout.pipe(outputStream);

    const ffmpegDone = new Promise<void>((resolve, reject) => {
      ffmpeg.on('error', reject);
      ffmpeg.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg concat failed (exit ${code}): ${ffmpegErrorOutput}`));
      });
    });

    const concatUpload = new Upload({
      client: s3,
      params: {
        Bucket: CLIPS_BUCKET,
        Key: key,
        Body: outputStream,
        ContentType: 'video/mp4',
      },
    });

    await Promise.all([concatUpload.done(), ffmpegDone]);

    return {
      s3Key: key,
      s3Url: `https://${CLIPS_BUCKET}.s3.${CLIPS_REGION}.amazonaws.com/${key}`,
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}
