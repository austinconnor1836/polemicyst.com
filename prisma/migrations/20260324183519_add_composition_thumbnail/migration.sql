-- CreateTable
CREATE TABLE "CompositionThumbnail" (
    "id" TEXT NOT NULL,
    "compositionId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "s3Url" TEXT NOT NULL,
    "hookText" TEXT NOT NULL,
    "frameTimestampS" DOUBLE PRECISION NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompositionThumbnail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompositionThumbnail_compositionId_idx" ON "CompositionThumbnail"("compositionId");

-- AddForeignKey
ALTER TABLE "CompositionThumbnail" ADD CONSTRAINT "CompositionThumbnail_compositionId_fkey" FOREIGN KEY ("compositionId") REFERENCES "Composition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
