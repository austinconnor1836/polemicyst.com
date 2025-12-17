
import fetch from 'node-fetch';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';

export async function downloadFeedVideoToTemp(s3Url: string): Promise<string> {
  // Create temp directory if not exists
  const tempDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempFilePath = path.join(tempDir, `${randomUUID()}.mp4`);
  console.info(`⬇️ Downloading to ${tempFilePath}...`);

  try {
    if (s3Url.includes('youtube.com') || s3Url.includes('youtu.be')) {
      console.info('📹 Detected YouTube URL, using yt-dlp...');
      const ytdlp = spawn('yt-dlp', ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '-o', tempFilePath, s3Url]);
      
      let ytError = '';
      ytdlp.stderr.on('data', d => ytError += d.toString());
      
      const downloadExitCode = await new Promise(resolve => ytdlp.on('close', resolve));
      if (downloadExitCode !== 0) {
        throw new Error(`yt-dlp failed: ${ytError}`);
      }
    } else {
      const videoRes = await fetch(s3Url);
      if (!videoRes.ok || !videoRes.body) {
        throw new Error('Failed to fetch video stream from S3');
      }
      await pipeline(videoRes.body, fs.createWriteStream(tempFilePath));
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
