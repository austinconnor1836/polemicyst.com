import { prisma } from '../shared/lib/prisma';

async function main() {
  const videos = await prisma.feedVideo.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      s3Url: true,
      feedId: true,
      thumbnailUrl: true,
    },
  });

  console.log(JSON.stringify(videos, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
