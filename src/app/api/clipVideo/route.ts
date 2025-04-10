import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

type Highlight = {
  start: number;
  end: number;
};

const TEMP_DIR = path.join(process.cwd(), 'tmp');
const CLIPS_DIR = path.join(process.cwd(), 'public', 'clips');

if (!fs.existsSync(CLIPS_DIR)) {
  fs.mkdirSync(CLIPS_DIR, { recursive: true });
}

export async function POST(req: NextRequest) {
  try {
    const { highlights, filename } = await req.json() as {
      highlights: Highlight[];
      filename: string;
    };

    if (!highlights?.length || !filename) {
      return new Response(JSON.stringify({ error: 'Missing highlights or filename' }), { status: 400 });
    }

    const inputPath = path.join(TEMP_DIR, filename);

    if (!fs.existsSync(inputPath)) {
      return new Response(JSON.stringify({ error: 'Original video not found' }), { status: 404 });
    }

    const clipPaths: string[] = [];

    for (const [index, h] of highlights.entries()) {
      const outputFilename = `${randomUUID()}.mp4`;
      const outputPath = path.join(CLIPS_DIR, outputFilename);

      const duration = Math.min(h.end - h.start, 90); // ✅ limit to 90 seconds

      await new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
          '-ss', h.start.toString(),
          '-t', duration.toString(), // ✅ use -t for duration instead of -to for end time
          '-i', inputPath,
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-preset', 'fast',
          outputPath,
        ]);

        ffmpeg.on('exit', (code) => {
          if (code === 0) {
            clipPaths.push(`/clips/${outputFilename}`);
            resolve(true);
          } else {
            reject(new Error(`FFmpeg failed on highlight ${index}`));
          }
        });
      });
    }

    return new Response(JSON.stringify({ clips: clipPaths }), { status: 200 });

  } catch (error: any) {
    console.error('Error clipping video:', error.message);
    return new Response(JSON.stringify({ error: 'Failed to clip video' }), { status: 500 });
  }
}
