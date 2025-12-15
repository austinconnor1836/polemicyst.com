import { prisma } from '../shared/lib/prisma';

async function main() {
  const take = Number(process.env.TAKE ?? 20);
  const userId = process.env.USER_ID;
  const feedVideoId = process.env.FEED_VIDEO_ID;

  const segments = await prisma.segment.findMany({
    where: {
      ...(userId ? { video: { userId } } : {}),
      ...(feedVideoId ? { features: { path: ['feedVideoId'], equals: feedVideoId } } : {}),
    } as any,
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      video: { select: { id: true, userId: true, videoTitle: true, s3Url: true, createdAt: true } },
    },
  });

  console.log(
    JSON.stringify(
      segments.map((s) => ({
        id: s.id,
        videoId: s.videoId,
        tStartS: s.tStartS,
        tEndS: s.tEndS,
        score: s.score,
        createdAt: s.createdAt,
        video: s.video,
        features: s.features,
      })),
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


