import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { transcribeLocalFile } from '@shared/lib/transcription';
import {
  detectSilenceFFmpeg,
  analyzeForAutoEdit,
  type TranscriptSegment,
} from '@shared/util/auto-edit-analyzer';
import {
  mergeAutoEditSettings,
  getAggressivenessConfig,
  type AutoEditSettings,
} from '@shared/auto-edit';
import { prisma } from '@shared/lib/prisma';

const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3001', 10);

const tmpDir = path.join('/tmp', 'transcribe-uploads');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: tmpDir,
    filename: (_req, _file, cb) => cb(null, `${randomUUID()}.mp4`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
});

const app = express();

// CORS — allow browser uploads from the Next.js dev server
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/transcribe', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const tempPath = file.path;
  const compositionId = req.query.compositionId as string | undefined;
  const userId = req.query.userId as string | undefined;

  try {
    console.log(
      `[http-transcribe] Starting transcription for ${file.originalname} (${(file.size / 1024 / 1024).toFixed(1)} MB)`
    );

    // Run Whisper transcription
    const result = await transcribeLocalFile(tempPath);

    console.log(
      `[http-transcribe] Transcription complete: ${result.segments.length} segments, ${result.transcript.length} chars`
    );

    // Run auto-edit analysis if we have the composition context
    let silenceRegions: Array<{ startS: number; endS: number }> | undefined;
    let autoEditResult: ReturnType<typeof analyzeForAutoEdit> | undefined;

    if (compositionId && userId) {
      try {
        const comp = await prisma.composition.findUnique({
          where: { id: compositionId },
          select: { creatorDurationS: true, cuts: true },
        });

        const rule = await prisma.automationRule.findUnique({
          where: { userId },
          select: { autoEditSettings: true },
        });

        const durationS = comp?.creatorDurationS;
        if (durationS) {
          const settings = mergeAutoEditSettings(
            rule?.autoEditSettings as Partial<AutoEditSettings> | null
          );
          const aggrConfig = getAggressivenessConfig(settings.aggressiveness);

          silenceRegions = await detectSilenceFFmpeg(
            tempPath,
            aggrConfig.silenceThresholdDb,
            aggrConfig.minSilenceDurationS
          );

          console.log(`[http-transcribe] silencedetect found ${silenceRegions.length} regions`);

          const segments = result.segments as unknown as TranscriptSegment[];
          autoEditResult = analyzeForAutoEdit(segments, settings, durationS, silenceRegions);

          console.log(
            `[http-transcribe] Auto-edit: ${autoEditResult.summary.totalCuts} cuts ` +
              `(${autoEditResult.summary.totalRemovedS}s removed)`
          );
        }
      } catch (autoEditErr) {
        console.warn(
          '[http-transcribe] Auto-edit failed (non-fatal):',
          autoEditErr instanceof Error ? autoEditErr.message : autoEditErr
        );
      }
    }

    res.json({
      transcript: result.transcript,
      segments: result.segments,
      ...(silenceRegions && { silenceRegions }),
      ...(autoEditResult && { autoEditResult }),
    });
  } catch (err) {
    console.error('[http-transcribe] Failed:', err instanceof Error ? err.message : err);
    res.status(500).json({
      error: 'Transcription failed',
      details: err instanceof Error ? err.message : String(err),
    });
  } finally {
    // Clean up temp file
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}
  }
});

export function startHttpServer() {
  app.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`[http-server] Listening on port ${HTTP_PORT}`);
  });
}
