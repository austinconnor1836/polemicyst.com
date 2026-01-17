import { spawn } from 'child_process';
import { PassThrough } from 'stream';
const fetch = require('node-fetch');
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

const CLIPS_BUCKET = 'clips-genie-uploads';
const CLIPS_REGION = 'us-east-2';
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
