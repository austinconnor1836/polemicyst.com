
import { spawn } from 'child_process';
import { PassThrough } from 'stream';
import fetch from 'node-fetch';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

const s3 = new S3Client({ region: 'us-east-1' });

function parseTimeToSeconds(t: string): number {
  const [hh, mm, ss] = t.split(':').map(parseFloat);
  return hh * 3600 + mm * 60 + ss;
}

export async function generateClipFromS3(inputPath: string, start: string, end: string, key: string) {
  const duration = parseTimeToSeconds(end) - parseTimeToSeconds(start);
  const isUrl = inputPath.startsWith('http');

  const ffmpegArgs = [
    '-ss', start,
    '-i', isUrl ? 'pipe:0' : inputPath,
    '-t', duration.toString(),
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-f', 'mp4',
    'pipe:1',
  ];

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  if (isUrl) {
    const inputStream = await fetch(inputPath).then(res => res.body!);
    inputStream.pipe(ffmpeg.stdin!);
  }

  const outputStream = new PassThrough();
  ffmpeg.stdout.pipe(outputStream);

  const parallelUploads3 = new Upload({
    client: s3,
    params: {
      Bucket: process.env.S3_BUCKET!,
      Key: key,
      Body: outputStream,
      ContentType: 'video/mp4',
    },
  });

  await parallelUploads3.done();

  return {
    s3Key: key,
    s3Url: `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${key}`,
  };
}
