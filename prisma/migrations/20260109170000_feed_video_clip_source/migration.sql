-- AlterTable
ALTER TABLE "FeedVideo" ADD COLUMN     "clipSourceVideoId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FeedVideo_clipSourceVideoId_key" ON "FeedVideo"("clipSourceVideoId");

-- AddForeignKey
ALTER TABLE "FeedVideo" ADD CONSTRAINT "FeedVideo_clipSourceVideoId_fkey" FOREIGN KEY ("clipSourceVideoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;
