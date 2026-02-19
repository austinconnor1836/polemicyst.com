const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const clips = await prisma.video.findMany({
    where: { sourceVideoId: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log(clips.map((c) => ({ id: c.id, title: c.videoTitle, createdAt: c.createdAt })));
  await prisma.$disconnect();
})();
