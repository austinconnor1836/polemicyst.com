import { prisma } from '../shared/lib/prisma';

async function main() {
  const labels = await prisma.segmentRhetoricLabel.findMany({
    include: {
      segment: {
        include: {
          video: {
            select: { id: true, transcript: true, videoTitle: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const payload = labels.map((entry) => ({
    segmentId: entry.segmentId,
    label: entry.label,
    notes: entry.notes,
    transcript: entry.segment.video?.transcript ?? null,
    videoTitle: entry.segment.video?.videoTitle ?? null,
    tStartS: entry.segment.tStartS,
    tEndS: entry.segment.tEndS,
  }));

  console.log(JSON.stringify(payload, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
