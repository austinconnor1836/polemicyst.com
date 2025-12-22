import { prisma } from '../shared/lib/prisma';

async function main() {
  const user = await prisma.user.findFirst({
    orderBy: { email: 'asc' },
    select: { id: true, email: true, name: true },
  });

  const feedVideo = await prisma.feedVideo.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, s3Url: true, createdAt: true, userId: true },
  });

  console.log(JSON.stringify({ user, feedVideo }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
