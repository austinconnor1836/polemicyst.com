import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';

const YT_DLP_TIMEOUT_MS = Number(process.env.YT_DLP_TIMEOUT_MS || 120_000);

async function runYtDlp(url: string, outputPath: string, extraArgs: string[] = []) {
  const baseArgs = [
    '-f',
    'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '-o',
    outputPath,
    '--merge-output-format',
    'mp4',
    '--retries',
    '3',
    '--fragment-retries',
    '3',
  ];

  const args = [...baseArgs, ...extraArgs, url];
  console.info(`🎞️ Running yt-dlp with args: ${args.join(' ')}`);

  return new Promise<void>((resolve, reject) => {
    const child = spawn('yt-dlp', args);
    let stderr = '';
    const timeout = setTimeout(() => {
      stderr += '\nyt-dlp timed out';
      child.kill('SIGKILL');
    }, YT_DLP_TIMEOUT_MS);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`yt-dlp exited with code ${code}: ${stderr}`));
      }
    });
  });
}

export async function downloadFeedVideoToTemp(s3Url: string): Promise<string> {
  const tempDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempFilePath = path.join(tempDir, `${randomUUID()}.mp4`);
  console.info(`⬇️ Downloading to ${tempFilePath}...`);

  try {
    if (s3Url.includes('youtube.com') || s3Url.includes('youtu.be')) {
      console.info('📹 Detected YouTube URL, using yt-dlp with redundancy...');
      try {
        await runYtDlp(s3Url, tempFilePath);
      } catch (primaryErr) {
        console.warn(`⚠️ yt-dlp primary attempt failed: ${(primaryErr as Error).message}`);
        // Redundant attempt with relaxed flags (no certificate check + generic UA)
        await runYtDlp(s3Url, tempFilePath, [
          '--no-check-certificate',
          '--user-agent',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        ]);
      }
    } else {
      const videoRes = await globalThis.fetch(s3Url);
      if (!videoRes.ok || !videoRes.body) {
        throw new Error('Failed to fetch video stream from S3');
      }
      const nodeStream = Readable.fromWeb(videoRes.body as import('stream/web').ReadableStream);
      await pipeline(nodeStream, fs.createWriteStream(tempFilePath));
    }

    console.info('✅ Download complete.');
    return tempFilePath;
  } catch (error) {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    throw error;
  }
}
