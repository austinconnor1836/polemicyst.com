import fetch from 'node-fetch';
import { prisma } from '@shared/lib/prisma';
import { spawn } from 'child_process';

export async function transcribeFeedVideo(feedVideoId: string): Promise<{ transcript: string, segments: any[] }> {
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

  const videoRes = await fetch(feedVideo.s3Url);
  if (!videoRes.ok || !videoRes.body) {
    throw new Error('Failed to fetch video stream from S3');
  }


  const pythonProcess = spawn('python3', ['/app/scripts/transcribe.py', '-'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Robust error handling for EPIPE and stream errors
  let output = '';
  let error = '';
  let streamEnded = false;
  let processClosed = false;

  // Handle errors on the video stream
  videoRes.body.on('error', (err) => {
    console.error('Error reading video stream:', err);
    pythonProcess.stdin?.destroy(err);
  });

  // Handle errors on the python process stdin
  pythonProcess.stdin?.on('error', (err) => {
    // Type guard for 'code' property
    const errorWithCode = err as NodeJS.ErrnoException;
    if (errorWithCode.code === 'EPIPE') {
      console.error('EPIPE: Python process closed stdin early.');
    } else {
      console.error('Error writing to python stdin:', err);
    }
  });

  // If the process closes before the stream ends, unpipe/destroy
  pythonProcess.on('close', (code) => {
    processClosed = true;
    if (!streamEnded) {
      videoRes.body.unpipe(pythonProcess.stdin!);
      pythonProcess.stdin?.destroy();
    }
  });

  // Track when the stream ends
  videoRes.body.on('end', () => {
    streamEnded = true;
  });

  videoRes.body.pipe(pythonProcess.stdin!);

  pythonProcess.stdout.on('data', d => output += d.toString());
  pythonProcess.stderr.on('data', d => error += d.toString());

  const exitCode: number = await new Promise(resolve =>
    pythonProcess.on('close', resolve)
  );

  if (exitCode !== 0) {
    console.error('Python stderr:', error);
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
