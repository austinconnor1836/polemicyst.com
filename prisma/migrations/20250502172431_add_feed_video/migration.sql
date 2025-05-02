-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "approvedForSplicing" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FeedVideo" (
    "id" TEXT NOT NULL,
    "feedId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "s3Url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeedVideo_feedId_videoId_key" ON "FeedVideo"("feedId", "videoId");

-- AddForeignKey
ALTER TABLE "FeedVideo" ADD CONSTRAINT "FeedVideo_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "VideoFeed"("id") ON DELETE CASCADE ON UPDATE CASCADE;
