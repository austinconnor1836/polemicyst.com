import express, { Request, Response } from 'express';
import { prisma } from '../../shared/lib/prisma';
import { transcribeFeedVideo } from '../lib/transcription';
import { generateViralClips } from '../lib/clip-generation';
import { uploadToS3 } from '../lib/s3';
import { burnInCaptions } from '../lib/video';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { queue } from '../queues';

const router = express.Router();

router.post('/', async (req: Request, res: Response): Promise<any> => {
  const { feedVideoId, userId } = req.body as {
    feedVideoId?: string;
    userId?: string;
  };

  if (!feedVideoId || !userId) {
    return res.status(400).json({ error: 'feedVideoId and userId are required' });
  }

  try {
    console.log('clip-generation hit');

    // Step 1: Transcribe the video
    await transcribeFeedVideo(feedVideoId);

    // Step 2: Generate clips with subtitles
    const clipResults = await generateViralClips(feedVideoId);
    const createdClips = [];

    for (const clip of clipResults) {
      const uuid = randomUUID();

      // Step 3: Burn subtitles into the video
      const burnedPath = await burnInCaptions(clip.videoPath, clip.srtPath);

      // Step 4: Upload burned-in video
      const videoUpload = await uploadToS3(burnedPath, `video-uploads/${uuid}-clip.mp4`);

      // Step 5: Save to database
      const created = await prisma.video.create({
        data: {
          userId,
          videoTitle: '', // will be updated later
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
          fileName: '' // optional
        }
      });

      // Step 6: Enqueue metadata generation job
      await queue.add('generate', {
        videoId: created.id,
        transcript: clip.text
      });

      // Step 7: Clean up temp files
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
