/*
  Warnings:

  - You are about to drop the `Transcription` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "Transcription";

-- CreateTable
CREATE TABLE "ClipCropTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aspectRatio" TEXT NOT NULL,
    "cropX" DOUBLE PRECISION NOT NULL,
    "cropY" DOUBLE PRECISION NOT NULL,
    "cropWidth" DOUBLE PRECISION NOT NULL,
    "cropHeight" DOUBLE PRECISION NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipCropTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClipCropTemplate_userId_idx" ON "ClipCropTemplate"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ClipCropTemplate_userId_name_key" ON "ClipCropTemplate"("userId", "name");

-- AddForeignKey
ALTER TABLE "ClipCropTemplate" ADD CONSTRAINT "ClipCropTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
