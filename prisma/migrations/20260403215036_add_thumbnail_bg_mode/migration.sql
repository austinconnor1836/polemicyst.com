-- AlterTable
ALTER TABLE "Composition" ADD COLUMN     "thumbnailBgMode" TEXT NOT NULL DEFAULT 'frame';

-- AlterTable
ALTER TABLE "ThumbnailAsset" ADD COLUMN     "styleVariant" TEXT;
