-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "sourceVideoId" TEXT;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_sourceVideoId_fkey" FOREIGN KEY ("sourceVideoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;
