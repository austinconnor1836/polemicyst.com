import express, { Request, Response } from 'express';
import { spawn } from 'child_process';
import fetch from 'node-fetch';
import { prisma } from '../../shared/lib/prisma'; // Adjust path as needed

const router = express.Router();

router.post('/', async (req: Request, res: Response): Promise<any> => {
  const { id } = req.body as { id?: string };

  if (!id) {
    return res.status(400).json({ error: 'feedVideoId required' });
  }

  try {
    const feedVideo = await prisma.feedVideo.findUnique({
      where: { id },
    });

    if (!feedVideo || !feedVideo.s3Url) {
      return res.status(404).json({ error: 'Feed video not found or missing s3Url' });
    }

    const videoRes = await fetch(feedVideo.s3Url);
    if (!videoRes.ok || !videoRes.body) {
      throw new Error('Failed to fetch video stream from S3');
    }

    const pythonProcess = spawn('python3', ['scripts/transcribe.py', '-'], {
      cwd: __dirname + '/../',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    videoRes.body.pipe(pythonProcess.stdin!); // TypeScript: ensure not null

    let transcript = '';
    let error = '';

    pythonProcess.stdout.on('data', (data: Buffer) => {
      transcript += data.toString();
    });

    pythonProcess.stderr.on('data', (data: Buffer) => {
      error += data.toString();
    });

    pythonProcess.on('close', async (code: number) => {
      if (code !== 0) {
        console.error('Transcription error:', error);
        return res.status(500).json({ error: 'Transcription failed', details: error });
      }

      try {
        await prisma.feedVideo.update({
          where: { id },
          data: { transcript },
        });

        return res.json({ transcript });
      } catch (e: any) {
        return res.status(500).json({ error: 'Failed to save transcript', details: e.message });
      }
    });
  } catch (err: any) {
    console.error('❌ Transcription route error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export default router;
