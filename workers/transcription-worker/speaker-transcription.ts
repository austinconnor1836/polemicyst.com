const fetch = require('node-fetch');
import { prisma } from '@shared/lib/prisma';
import { spawn } from 'child_process';

export interface SpeakerSegment {
  start: number;
  end: number;
  text: string;
  speaker: string;
}

export interface SpeakerTranscriptResult {
  transcript: string;
  segments: SpeakerSegment[];
  speakers: string[];
}

export async function transcribeFeedVideoWithSpeakers(
  feedVideoId: string,
  options?: { numSpeakers?: number }
): Promise<SpeakerTranscriptResult> {
  console.info('Checking for existing speaker transcript...');

  const feedVideo = await prisma.feedVideo.findUnique({
    where: { id: feedVideoId },
  });

  if (!feedVideo?.s3Url) {
    throw new Error('Feed video not found or missing S3 URL');
  }

  // Return cached result if available
  if (feedVideo.speakerTranscriptJson) {
    console.info('Speaker transcript already exists, skipping');
    const cached = feedVideo.speakerTranscriptJson as unknown as SpeakerTranscriptResult;
    return {
      transcript: cached.transcript || feedVideo.transcript || '',
      segments: cached.segments || [],
      speakers: cached.speakers || [],
    };
  }

  console.info('Starting transcription with speaker diarization...');

  const videoRes = await fetch(feedVideo.s3Url);
  if (!videoRes.ok || !videoRes.body) {
    throw new Error('Failed to fetch video stream from S3');
  }

  const args = ['/app/scripts/transcribe_with_speakers.py', '-'];
  if (options?.numSpeakers) {
    args.push('--num-speakers', String(options.numSpeakers));
  }

  const pythonProcess = spawn('python3', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Robust error handling (same pattern as transcription.ts)
  let output = '';
  let error = '';
  let streamEnded = false;

  videoRes.body.on('error', (err: NodeJS.ErrnoException) => {
    console.error('Error reading video stream:', err);
    pythonProcess.stdin?.destroy(err);
  });

  pythonProcess.stdin?.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') {
      console.error('EPIPE: Python process closed stdin early.');
    } else {
      console.error('Error writing to python stdin:', err);
    }
  });

  pythonProcess.on('close', () => {
    if (!streamEnded) {
      videoRes.body.unpipe(pythonProcess.stdin!);
      pythonProcess.stdin?.destroy();
    }
  });

  videoRes.body.on('end', () => {
    streamEnded = true;
  });

  videoRes.body.pipe(pythonProcess.stdin!);

  pythonProcess.stdout.on('data', (d: Buffer) => (output += d.toString()));
  pythonProcess.stderr.on('data', (d: Buffer) => {
    const msg = d.toString();
    error += msg;
    process.stderr.write(msg);
  });

  const exitCode: number = await new Promise((resolve) =>
    pythonProcess.on('close', resolve)
  );

  if (exitCode !== 0) {
    console.error('Python stderr:', error);
    throw new Error(`Speaker transcription failed: ${error}`);
  }

  let parsed: SpeakerTranscriptResult;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error('Failed to parse speaker transcript output');
  }

  // Store in database
  await prisma.feedVideo.update({
    where: { id: feedVideoId },
    data: {
      transcript: parsed.transcript,
      transcriptJson: parsed.segments,
      speakerTranscriptJson: parsed as any,
    },
  });

  return parsed;
}
