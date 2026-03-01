import { prisma } from '../shared/lib/prisma';
import { downloadFeedVideoToTemp } from '../backend/utils/download';
import { uploadToS3 } from '../backend/lib/s3';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { promises as fsp } from 'fs';

async function main() {
  const userId = process.env.USER_ID;
  const videoSource = process.env.VIDEO_URL;
  const filename = process.env.FILENAME;

  if (!userId || !videoSource) {
    throw new Error('Provide USER_ID and VIDEO_URL env vars');
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error(`User ${userId} not found`);
  }

  let manualFeed = await prisma.videoFeed.findFirst({
    where: { userId, sourceType: 'manual' },
  });

  if (!manualFeed) {
    manualFeed = await prisma.videoFeed.create({
      data: {
        userId,
        name: 'Manual Uploads',
        sourceType: 'manual',
        sourceUrl: 'manual://uploads',
        pollingInterval: 0,
      },
    });
  }

  let tempPath: string | null = null;
  let shouldCleanup = false;
  try {
    if (videoSource.startsWith('http')) {
      tempPath = await downloadFeedVideoToTemp(videoSource);
      shouldCleanup = true;
    } else {
      const resolvedPath = path.isAbsolute(videoSource)
        ? videoSource
        : path.resolve(process.cwd(), videoSource);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Local file not found: ${resolvedPath}`);
      }
      tempPath = resolvedPath;
    }

    const derivedExt =
      (filename && path.extname(filename)) ||
      (() => {
        try {
          if (videoSource.startsWith('http')) {
            return path.extname(new URL(videoSource).pathname);
          }
          return path.extname(videoSource);
        } catch {
          return '';
        }
      })() ||
      '.mp4';

    const key = `uploads/${userId}/${randomUUID()}${derivedExt}`;
    const { url } = await uploadToS3(tempPath, key);

    const newVideo = await prisma.feedVideo.create({
      data: {
        feedId: manualFeed.id,
        userId,
        videoId: randomUUID(),
        title:
          filename ||
          (videoSource.startsWith('http')
            ? videoSource.split('/').pop()
            : path.basename(videoSource)) ||
          'Imported Video',
        s3Url: url,
      },
    });

    console.log(`Created FeedVideo ${newVideo.id}`);
    console.log(`S3 URL: ${url}`);
  } finally {
    if (shouldCleanup && tempPath) {
      await fsp.unlink(tempPath).catch(() => {});
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
