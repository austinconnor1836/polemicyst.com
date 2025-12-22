import { prisma } from '../shared/lib/prisma';

async function main() {
  const userId = process.env.USER_ID;
  if (!userId) {
    console.error('Please provide USER_ID');
    process.exit(1);
  }

  const recentClips = await prisma.video.findMany({
    where: {
      userId: userId,
      sourceVideoId: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  console.log(`Found ${recentClips.length} clips.`);
  recentClips.forEach((c) => {
    console.log(`- [${c.createdAt.toISOString()}] ${c.videoTitle}`);
  });
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
