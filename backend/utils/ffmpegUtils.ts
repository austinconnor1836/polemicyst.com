import { spawn } from 'child_process';
import { PassThrough } from 'stream';
import fetch from 'node-fetch';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: 'us-east-1' });

function parseTimeToSeconds(t: string): number {
  const [hh, mm, ss] = t.split(':').map(parseFloat);
  return hh * 3600 + mm * 60 + ss;
}

export async function generateClipFromS3(s3Url: string, start: string, end: string, key: string) {
  const inputStream = await fetch(s3Url).then(res => res.body!);
  const duration = parseTimeToSeconds(end) - parseTimeToSeconds(start);

  const ffmpeg = spawn('ffmpeg', [
    '-ss', start,
    '-i', 'pipe:0',
    '-t', duration.toString(),
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-f', 'mp4',
    'pipe:1',
  ]);

  inputStream.pipe(ffmpeg.stdin!);
  const outputStream = new PassThrough();
  ffmpeg.stdout.pipe(outputStream);

  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET!,
    Key: key,
    Body: outputStream,
    ContentType: 'video/mp4',
  }));

  return {
    s3Key: key,
    s3Url: `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${key}`,
  };
}
