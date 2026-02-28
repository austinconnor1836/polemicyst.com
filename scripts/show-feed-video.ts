import { prisma } from '../shared/lib/prisma';

async function main() {
  const feedVideoId = process.env.FEED_VIDEO_ID;
  if (!feedVideoId) {
    throw new Error('Provide FEED_VIDEO_ID');
  }

  const feedVideo = await prisma.feedVideo.findUnique({ where: { id: feedVideoId } });
  console.log(JSON.stringify(feedVideo, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
