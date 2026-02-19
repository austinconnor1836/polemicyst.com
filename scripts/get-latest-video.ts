import { prisma } from '../shared/lib/prisma';

async function main() {
  const latestVideo = await prisma.feedVideo.findFirst({
    orderBy: { createdAt: 'desc' },
  });

  if (latestVideo) {
    console.log(`FEED_VIDEO_ID=${latestVideo.id}`);
    console.log(`USER_ID=${latestVideo.userId}`);
    console.log(`S3_URL=${latestVideo.s3Url}`);
  } else {
    console.log('No videos found');
  }
}

main();
