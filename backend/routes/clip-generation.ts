import express, { Request, Response } from 'express';
import { prisma } from '../../shared/lib/prisma';
import { transcribeFeedVideo } from '../lib/transcription';
import { generateViralClips } from '../lib/clip-generation';
import { uploadToS3 } from '../lib/s3'; // make sure this exists

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
    // 🔁 Step 1: Transcribe and store to DB
    await transcribeFeedVideo(feedVideoId);

    // 🎬 Step 2: Generate viral clips and subtitles
    const clipResults = await generateViralClips(feedVideoId);

    const createdClips = [];

    for (const clip of clipResults) {
      // Upload video and .srt to S3
      const [videoUpload, srtUpload] = await Promise.all([
        uploadToS3(clip.videoPath, `clips/${feedVideoId}/${Date.now()}-clip.mp4`),
        uploadToS3(clip.srtPath, `clips/${feedVideoId}/${Date.now()}-captions.srt`)
      ]);

      // Create a new Video entry in the DB
      const created = await prisma.video.create({
        data: {
          userId,
          sourceVideoId: feedVideoId,
          videoTitle: clip.text.slice(0, 100),
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

      createdClips.push(created);
    }

    return res.json({ message: '✅ Clips generated successfully', clips: createdClips });
  } catch (err: any) {
    console.error('❌ Clip generation failed:', err);
    return res.status(500).json({ error: 'Clip generation failed', details: err.message });
  }
});

export default router;
