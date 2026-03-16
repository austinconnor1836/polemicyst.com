-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "publishError" TEXT,
ADD COLUMN     "substackDraftId" TEXT;

-- AlterTable
ALTER TABLE "Publication" ADD COLUMN     "substackCookieEnc" TEXT,
ADD COLUMN     "substackPublicationId" TEXT;
