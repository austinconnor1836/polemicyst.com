import { Prisma } from '@prisma/client';
import { prisma } from '../shared/lib/prisma';

async function main() {
  const feedVideoId = process.env.FEED_VIDEO_ID;
  const newUrl = process.env.NEW_URL;

  if (!feedVideoId || !newUrl) {
    console.error('Provide FEED_VIDEO_ID and NEW_URL');
    process.exit(1);
  }

  await prisma.feedVideo.update({
    where: { id: feedVideoId },
    data: {
      s3Url: newUrl,
      transcript: null,
      transcriptJson: Prisma.DbNull,
    },
  });

  // Also delete any partial Video record to allow retry?
  // No, the worker handles idempotency (or creates duplicates, which is fine for test).

  console.log(`Updated ${feedVideoId} to ${newUrl}`);
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
