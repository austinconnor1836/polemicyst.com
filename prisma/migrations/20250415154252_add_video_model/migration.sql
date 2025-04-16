-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "videoTitle" TEXT NOT NULL,
    "sharedDescription" TEXT NOT NULL,
    "facebookTemplate" TEXT NOT NULL,
    "instagramTemplate" TEXT NOT NULL,
    "youtubeTemplate" TEXT NOT NULL,
    "blueskyTemplate" TEXT NOT NULL,
    "twitterTemplate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
