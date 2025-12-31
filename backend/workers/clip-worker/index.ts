import { Worker, Queue, QueueEvents, Job } from 'bullmq';
import Redis from 'ioredis';
// @ts-ignore
import { prisma } from './shared/lib/prisma';
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import fetch from 'node-fetch';

// Configuration
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');

const redisConnection = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  maxRetriesPerRequest: null,
});

// Queues for scoring
const provocativenessQueue = new Queue('score-provocativeness', { connection: redisConnection });
const comedicQueue = new Queue('score-comedic', { connection: redisConnection });

const provocativenessEvents = new QueueEvents('score-provocativeness', {
  connection: redisConnection,
});
const comedicEvents = new QueueEvents('score-comedic', { connection: redisConnection });

// Helper: Download video
async function downloadVideo(url: string, dest: string) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to download video: ${res.statusText}`);
  const stream = createWriteStream(dest);
  await new Promise<void>((resolve, reject) => {
    res.body!.pipe(stream);
    res.body!.on('error', (e) => reject(e));
    stream.on('finish', () => resolve());
  });
}

// Helper: Transcribe
async function transcribeVideo(videoPath: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const python = spawn('python3', ['scripts/transcribe.py', videoPath]);
    let output = '';
    let error = '';
    python.stdout.on('data', (d) => (output += d.toString()));
    python.stderr.on('data', (d) => (error += d.toString()));
    python.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Transcription failed: ${error}`));
      try {
        const parsed = JSON.parse(output);
        resolve(parsed.segments);
      } catch (e) {
        reject(new Error(`Invalid JSON: ${e}`));
      }
    });
  });
}

// Helper: Generate Clip (FFmpeg)
async function createClip(
  videoPath: string,
  start: number,
  end: number,
  text: string,
  outPath: string,
  aspectRatio: string
) {
  const srtPath = outPath.replace('.mp4', '.srt');
  const sTime = '00:00:00,000';
  const duration = end - start;
  const dDate = new Date(duration * 1000).toISOString().substring(11, 23).replace('.', ',');
  const srt = `1\n${sTime} --> ${dDate}\n${text}\n`;
  await fs.writeFile(srtPath, srt);

  const aspectRatioFilter = (() => {
    switch (aspectRatio) {
      case '16:9':
        return 'scale=1280:720,setsar=1';
      case '1:1':
        return 'scale=720:720,setsar=1';
      case '9:16':
      default:
        return 'scale=720:1280,setsar=1';
    }
  })();

  return new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-i',
      videoPath,
      '-ss',
      `${start}`,
      '-to',
      `${end}`,
      '-vf',
      `${aspectRatioFilter},subtitles=${srtPath.replace(/:/g, '\\:')}`,
      '-c:v',
      'libx264',
      '-c:a',
      'aac',
      outPath,
    ]);
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg failed (${code})`));
    });
  });
}

// Main Worker
new Worker(
  'clip-generation',
  async (job: Job) => {
    const { feedVideoId, userId, aspectRatio } = job.data;
    console.log(`📥 Processing clip-generation for ${feedVideoId}`);

    try {
      // 1. Fetch Video Info
      const feedVideo = await prisma.feedVideo.findUnique({ where: { id: feedVideoId } });
      if (!feedVideo || !feedVideo.s3Url) throw new Error('Video not found or missing S3 URL');

      const tempDir = `/tmp/${feedVideoId}`;
      await fs.mkdir(tempDir, { recursive: true });
      const videoPath = path.join(tempDir, 'source.mp4');

      // 2. Download
      console.log('⬇️ Downloading video...');
      await downloadVideo(feedVideo.s3Url, videoPath);

      // 3. Transcribe
      console.log('🎤 Transcribing...');
      const segments = await transcribeVideo(videoPath);

      // Save transcript to DB
      await prisma.feedVideo.update({
        where: { id: feedVideoId },
        data: {
          transcript: segments.map((s) => s.text).join(' '),
          transcriptJson: segments,
        },
      });

      // 4. Score Segments (Windowing)
      const windows = [];
      for (let i = 0; i < segments.length; i += 3) {
        const group = segments.slice(i, i + 3);
        const text = group.map((s) => s.text).join(' ');
        const start = group[0].start;
        const end = group[group.length - 1].end;
        windows.push({ start, end, text, index: i });
      }

      console.log(`🧠 Scoring ${windows.length} windows...`);

      const scoredWindows = await Promise.all(
        windows.map(async (w) => {
          // Dispatch jobs
          const pJob = await provocativenessQueue.add('score', { transcript: w.text });
          const cJob = await comedicQueue.add('score', { transcript: w.text });

          // Wait for results
          const [pResult, cResult] = await Promise.all([
            pJob.waitUntilFinished(provocativenessEvents),
            cJob.waitUntilFinished(comedicEvents),
          ]);

          return {
            ...w,
            provocativeness: pResult.score,
            comedic: cResult.score,
            pReasoning: pResult.reasoning,
            cReasoning: cResult.reasoning,
          };
        })
      );

      // 5. Select Best Clips
      const topProvocative = [...scoredWindows]
        .sort((a, b) => b.provocativeness - a.provocativeness)
        .slice(0, 2);
      const topComedic = [...scoredWindows].sort((a, b) => b.comedic - a.comedic).slice(0, 2);

      const selected = new Set([...topProvocative, ...topComedic]);

      console.log(`✂️ Generating ${selected.size} clips...`);

      const clips = [];
      for (const w of selected) {
        const outPath = path.join(tempDir, `clip-${w.index}.mp4`);
        await createClip(videoPath, w.start, w.end, w.text, outPath, aspectRatio || '9:16');

        console.log(`✅ Generated clip: ${outPath} (P: ${w.provocativeness}, C: ${w.comedic})`);

        // Create Video entry in DB
        await prisma.video.create({
          data: {
            userId,
            videoTitle: `Viral Clip ${w.index}`,
            s3Url: `file://${outPath}`, // Placeholder
            s3Key: `clips/${feedVideoId}/${w.index}`,
            transcript: w.text,
            approvedForSplicing: false,
            fileName: `clip-${w.index}.mp4`,
            sharedDescription: '',
            facebookTemplate: '',
            instagramTemplate: '',
            youtubeTemplate: '',
            blueskyTemplate: '',
            twitterTemplate: '',
          },
        });
      }

      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log('🏁 Job complete');
    } catch (err: any) {
      console.error('❌ Job failed:', err);
      throw err;
    }
  },
  { connection: redisConnection }
);
