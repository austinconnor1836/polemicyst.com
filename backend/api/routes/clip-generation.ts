import express, { Request, Response } from 'express';
import { prisma } from '@shared/lib/prisma';
import { transcribeFeedVideo } from '../lib/transcription';
import { generateViralClips } from '../lib/clip-generation';
import { uploadToS3 } from '../lib/s3';
import { burnInCaptions } from '../lib/video';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { queue } from '../../queues';

const router = express.Router();

router.post('/', async (req: Request, res: Response): Promise<any> => {
  const { feedVideoId, userId, aspectRatio } = req.body as {
    feedVideoId?: string;
    userId?: string;
    aspectRatio?: string;
  };

  if (!feedVideoId || !userId) {
    return res.status(400).json({ error: 'feedVideoId and userId are required' });
  }

  console.log('clip-generation hit with aspectRatio:', aspectRatio);

  try {
    // Step 1: Transcribe the video
    try {
      console.log('🔍 Checking for existing transcript...');
      await transcribeFeedVideo(feedVideoId);
      console.log('🎤 Transcription complete.');
    } catch (transcriptionError: any) {
      console.error('❌ Transcription failed:', transcriptionError);
      return res.status(500).json({
        error: 'Transcription failed',
        details: transcriptionError.message || 'Unknown transcription error'
      });
    }

    // Step 2: Generate clips with subtitles and aspect ratio
    const clipResults = await generateViralClips(feedVideoId, aspectRatio);
    const createdClips = [];

    for (const clip of clipResults) {
      const uuid = randomUUID();

      const burnedPath = await burnInCaptions(clip.videoPath, clip.srtPath);
      const videoUpload = await uploadToS3(burnedPath, `video-uploads/${uuid}-clip.mp4`);

      const created = await prisma.video.create({
        data: {
          userId,
          videoTitle: '',
          s3Url: videoUpload.url,
          s3Key: videoUpload.key,
          transcript: clip.text,
          approvedForSplicing: false,
          facebookTemplate: '',
          instagramTemplate: '',
          youtubeTemplate: '',
          blueskyTemplate: '',
          twitterTemplate: '',
          sharedDescription: '',
          fileName: ''
        }
      });

      await queue.add('generate', {
        videoId: created.id,
        transcript: clip.text
      }, {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 1000
        },
        removeOnComplete: true,
        removeOnFail: false,
      });

      // Clean up temp files
      await fs.unlink(clip.videoPath).catch(() => {});
      await fs.unlink(clip.srtPath).catch(() => {});
      await fs.unlink(burnedPath).catch(() => {});

      createdClips.push(created);
    }

    return res.json({ message: '✅ Clips generated successfully', clips: createdClips });

  } catch (err: any) {
    console.error('❌ Clip generation failed:', err);
    return res.status(500).json({ error: 'Clip generation failed', details: err.message });
  }
});

export default router;
