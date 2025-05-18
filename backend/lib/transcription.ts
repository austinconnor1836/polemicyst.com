import fetch from 'node-fetch';
import { prisma } from '../../shared/lib/prisma';
import { spawn } from 'child_process';
import { Request } from 'express';

export async function transcribeFeedVideo(feedVideoId: string): Promise<{ transcript: string, segments: any[] }> {
  const feedVideo = await prisma.feedVideo.findUnique({ where: { id: feedVideoId } });

  if (!feedVideo?.s3Url) {
    throw new Error('Feed video not found or missing S3 URL');
  }

  const videoRes = await fetch(feedVideo.s3Url);
  if (!videoRes.ok || !videoRes.body) {
    throw new Error('Failed to fetch video stream from S3');
  }

  const pythonProcess = spawn('python3', ['scripts/transcribe.py', '-'], {
    cwd: __dirname + '/../',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  videoRes.body.pipe(pythonProcess.stdin!);

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
    throw new Error('Failed to parse transcript output');
  }

  await prisma.feedVideo.update({
    where: { id: feedVideoId },
    data: {
      transcript: parsed.transcript,
      transcriptJson: parsed.segments,
    },
  });

  return parsed;
}
