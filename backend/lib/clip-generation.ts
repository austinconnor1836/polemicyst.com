import { prisma } from '../../shared/lib/prisma';
import fetch from 'node-fetch';
import { createWriteStream, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

export async function transcribeVideo(feedVideoId: string): Promise<any[]> {
  const feedVideo = await prisma.feedVideo.findUnique({
    where: { id: feedVideoId },
  });

  if (!feedVideo || !feedVideo.s3Url) {
    throw new Error('Missing feed video or S3 URL');
  }

  const videoPath = `/tmp/${feedVideoId}.mp4`;
  const videoRes = await fetch(feedVideo.s3Url);

  if (!videoRes.ok || !videoRes.body) {
    throw new Error('Failed to download video');
  }

  // Save video to disk
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(videoPath);
    videoRes.body.pipe(out);
    videoRes.body.on('error', reject);
    out.on('finish', resolve);
  });

  // Call the Python script
  const parsed: { transcript: string; segments: any[] } = await new Promise((resolve, reject) => {
    const python = spawn('python3', ['scripts/transcribe.py', videoPath]);

    let output = '';
    let error = '';

    python.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    python.stderr.on('data', (data: Buffer) => {
      error += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Transcription failed: ${error}`));
      try {
        resolve(JSON.parse(output));
      } catch (e) {
        reject(new Error(`Invalid JSON returned from transcription: ${e}`));
      }
    });
  });

  // Save to DB
  await prisma.feedVideo.update({
    where: { id: feedVideoId },
    data: {
      transcript: parsed.transcript,
      transcriptJson: parsed.segments,
    },
  });

  return parsed.segments;
}

export async function generateViralClips(feedVideoId: string) {
  console.info('Generating viral clips...')
  const feedVideo = await prisma.feedVideo.findUnique({
    where: { id: feedVideoId },
  });

  if (!feedVideo || !feedVideo.transcriptJson || !feedVideo.s3Url) {
    throw new Error('Missing transcript or video data');
  }

  const segments = feedVideo.transcriptJson as Array<{ start: number; end: number; text: string }>;

  const videoPath = `/tmp/${feedVideoId}.mp4`;
  const clipsDir = `/tmp/clips-${feedVideoId}`;
  await fs.mkdir(clipsDir, { recursive: true });

  const videoRes = await fetch(feedVideo.s3Url);
  if (!videoRes.ok || !videoRes.body) {
    throw new Error('Failed to fetch video');
  }

  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(videoPath);
    videoRes.body.pipe(out);
    videoRes.body.on('error', reject);
    out.on('finish', resolve);
  });

  const results = [];

  for (let i = 0; i < segments.length; i += 3) {
    const group = segments.slice(i, i + 3);
    const start = group[0].start;
    const end = group[group.length - 1].end;
    const outPath = path.join(clipsDir, `clip-${i}.mp4`);
    const srtPath = path.join(clipsDir, `clip-${i}.srt`);

    const srt = group.map((s, idx) => {
      const sTime = new Date(s.start * 1000).toISOString().substring(11, 23).replace('.', ',');
      const eTime = new Date(s.end * 1000).toISOString().substring(11, 23).replace('.', ',');
      return `${idx + 1}\n${sTime} --> ${eTime}\n${s.text}\n`;
    }).join('\n');

    writeFileSync(srtPath, srt, 'utf-8');

    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', videoPath,
        '-ss', `${start}`,
        '-to', `${end}`,
        '-vf', `subtitles=${srtPath.replace(/:/g, '\\:')}`, // escape colons for FFmpeg
        '-c:v', 'libx264',
        '-c:a', 'aac',
        outPath,
      ]);

      ffmpeg.stderr.on('data', d => process.stderr.write(d));
      ffmpeg.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg failed (${code})`));
      });
    });

    results.push({ videoPath: outPath, srtPath, text: group.map(g => g.text).join(' ') });
  }

  return results;
}

export async function runClipGeneration(feedVideoId: string) {
  console.log(`📼 Running clip-generation pipeline for ${feedVideoId}`);
  const segments = await transcribeVideo(feedVideoId);
  const clips = await generateViralClips(feedVideoId);
  console.log(`✅ Done: ${clips.length} clips created`);
  return { segments, clips };
}
