-- AlterTable
ALTER TABLE "FeedVideo" ADD COLUMN "clipGenerationStatus" TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE "FeedVideo" ADD COLUMN "clipGenerationError" TEXT;

-- AlterTable
ALTER TABLE "Video" ADD COLUMN "feedVideoId" TEXT;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_feedVideoId_fkey" FOREIGN KEY ("feedVideoId") REFERENCES "FeedVideo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
