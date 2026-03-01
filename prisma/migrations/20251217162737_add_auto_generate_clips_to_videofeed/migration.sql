-- AlterTable
ALTER TABLE "VideoFeed" ADD COLUMN     "autoGenerateClips" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "viralitySettings" JSONB;
