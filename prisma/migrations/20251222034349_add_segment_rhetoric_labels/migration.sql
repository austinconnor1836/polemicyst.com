-- AlterTable
ALTER TABLE "FeedVideo" ADD COLUMN     "thumbnailUrl" TEXT;

-- CreateTable
CREATE TABLE "SegmentRhetoricLabel" (
    "id" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "label" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SegmentRhetoricLabel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SegmentRhetoricLabel_segmentId_idx" ON "SegmentRhetoricLabel"("segmentId");

-- AddForeignKey
ALTER TABLE "SegmentRhetoricLabel" ADD CONSTRAINT "SegmentRhetoricLabel_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
