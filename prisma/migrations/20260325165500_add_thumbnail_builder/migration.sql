-- AlterTable
ALTER TABLE "Composition" ADD COLUMN     "thumbnailCutoutPosition" TEXT NOT NULL DEFAULT 'right',
ADD COLUMN     "thumbnailCutoutSize" TEXT NOT NULL DEFAULT 'large';

-- CreateTable
CREATE TABLE "ThumbnailAsset" (
    "id" TEXT NOT NULL,
    "compositionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "s3Url" TEXT NOT NULL,
    "frameTimestampS" DOUBLE PRECISION NOT NULL,
    "visionScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThumbnailAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ThumbnailAsset_compositionId_type_idx" ON "ThumbnailAsset"("compositionId", "type");

-- AddForeignKey
ALTER TABLE "ThumbnailAsset" ADD CONSTRAINT "ThumbnailAsset_compositionId_fkey" FOREIGN KEY ("compositionId") REFERENCES "Composition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
