import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { spawn } from 'child_process';
import AWS from 'aws-sdk';

const S3_BUCKET = process.env.S3_BUCKET || 'clips-genie-uploads';
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: S3_REGION,
  signatureVersion: 'v4',
});

function ffprobe(
  url: string
): Promise<{ durationS: number; width: number; height: number; hasAudio: boolean }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      url,
    ]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
      }

      try {
        const data = JSON.parse(stdout);
        const videoStream = data.streams?.find((s: any) => s.codec_type === 'video');
        const audioStream = data.streams?.find((s: any) => s.codec_type === 'audio');
        const durationS = parseFloat(data.format?.duration || videoStream?.duration || '0');
        const width = videoStream?.width || 0;
        const height = videoStream?.height || 0;

        resolve({
          durationS,
          width,
          height,
          hasAudio: !!audioStream,
        });
      } catch (parseErr) {
        reject(new Error(`Failed to parse ffprobe output: ${parseErr}`));
      }
    });

    proc.on('error', reject);
  });
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { s3Key } = body;

    if (!s3Key) {
      return NextResponse.json({ error: 's3Key is required' }, { status: 400 });
    }

    // Generate a presigned URL so ffprobe can access the file
    const presignedUrl = await s3.getSignedUrlPromise('getObject', {
      Bucket: S3_BUCKET,
      Key: s3Key,
      Expires: 300,
    });

    const result = await ffprobe(presignedUrl);

    return NextResponse.json(result);
  } catch (err) {
    console.error('[POST /api/compositions/probe]', err);
    return NextResponse.json({ error: 'Failed to probe video' }, { status: 500 });
  }
}
