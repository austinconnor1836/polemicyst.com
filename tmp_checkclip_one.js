const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const clips = await prisma.video.findMany({
    where: { sourceVideoId: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });
  console.log(clips[0]);
  await prisma.$disconnect();
})();
