
import fetch from 'node-fetch';
import { prisma } from '../../shared/lib/prisma';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';


export async function transcribeFeedVideo(feedVideoId: string, localFilePath?: string): Promise<{ transcript: string, segments: any[] }> {
  console.info('🔍 Checking for existing transcript...');

  const feedVideo = await prisma.feedVideo.findUnique({ where: { id: feedVideoId } });

  if (!feedVideo?.s3Url) {
    throw new Error('Feed video not found or missing S3 URL');
  }

  if (feedVideo.transcript && feedVideo.transcriptJson) {
    console.info('✅ Transcript already exists, skipping transcription');
    return {
      transcript: feedVideo.transcript,
      segments: feedVideo.transcriptJson as any[],
    };
  }

  console.info('🎤 Starting transcription...');

  // Create temp directory if not exists
  const tempDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Use provided path or fetch if not provided (fallback)
  // ideally the worker should always provide the path now
  let tempFilePath = localFilePath; 
  let shouldCleanup = false;

  try {
    if (!tempFilePath) {
    tempFilePath = path.join(tempDir, `${randomUUID()}.mp4`);
    shouldCleanup = true;
    
    // 1. Download to temp file
    console.info(`⬇️ Downloading to ${tempFilePath}...`);
    
    if (feedVideo.s3Url.includes('youtube.com') || feedVideo.s3Url.includes('youtu.be')) {
      console.info('📹 Detected YouTube URL, using yt-dlp...');
      const ytdlp = spawn('yt-dlp', ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '-o', tempFilePath, feedVideo.s3Url]);
      
      let ytError = '';
      ytdlp.stderr.on('data', d => ytError += d.toString());
      
      const downloadExitCode = await new Promise(resolve => ytdlp.on('close', resolve));
      if (downloadExitCode !== 0) {
        throw new Error(`yt-dlp failed: ${ytError}`);
      }
    } else {
      const videoRes = await fetch(feedVideo.s3Url);
      if (!videoRes.ok || !videoRes.body) {
        throw new Error('Failed to fetch video stream from S3');
      }
      await pipeline(videoRes.body, fs.createWriteStream(tempFilePath));
    }
    
    console.info('✅ Download complete.');
  } else {
    console.info(`✅ Using provided local video: ${tempFilePath}`);
  }

    // 2. Run Python script with file path
    const pythonPath = process.env.PYTHON_PATH || 'python3';
    const pythonProcess = spawn(pythonPath, ['backend/scripts/transcribe.py', tempFilePath], {
      cwd: path.join(__dirname, '../../'), // Go up to root from backend/lib
      stdio: ['ignore', 'pipe', 'pipe'], // Ignore stdin, capture stdout/stderr
    });

    let output = '';
    let error = '';

    pythonProcess.stdout.on('data', d => output += d.toString());
    pythonProcess.stderr.on('data', d => error += d.toString());

    const exitCode: number = await new Promise(resolve =>
      pythonProcess.on('close', resolve)
    );

    if (exitCode !== 0) {
      throw new Error(`Transcription failed: ${error}`);
    }

    let parsed: { transcript: string, segments: any[] };
    try {
      parsed = JSON.parse(output);
    } catch {
      throw new Error(`Failed to parse transcript output: ${output} (Error: ${error})`);
    }

    await prisma.feedVideo.update({
      where: { id: feedVideoId },
      data: {
        transcript: parsed.transcript,
        transcriptJson: parsed.segments,
      },
    });

    return parsed;

  } finally {
    // 3. Cleanup
    if (shouldCleanup && tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

