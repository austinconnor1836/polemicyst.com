import { prisma } from '../shared/lib/prisma';

async function main() {
  const segmentId = process.env.SEGMENT_ID;
  const labelRaw = process.env.LABEL;
  const notes = process.env.NOTES ?? null;

  if (!segmentId || !labelRaw) {
    throw new Error('Provide SEGMENT_ID and LABEL env vars');
  }

  const label = parseFloat(labelRaw);
  if (Number.isNaN(label)) {
    throw new Error('LABEL must be a number between 0 and 1');
  }

  const clamped = Math.min(Math.max(label, 0), 1);

  await prisma.segmentRhetoricLabel.create({
    data: {
      segmentId,
      label: clamped,
      notes,
    },
  });

  console.log(`Stored philosophy label ${clamped} for segment ${segmentId}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
