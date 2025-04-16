/*
  Warnings:

  - You are about to drop the `TemplateSettings` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "TemplateSettings" DROP CONSTRAINT "TemplateSettings_userId_fkey";

-- DropTable
DROP TABLE "TemplateSettings";

-- CreateTable
CREATE TABLE "TemplatePreferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "facebookTemplate" TEXT NOT NULL,
    "instagramTemplate" TEXT NOT NULL,
    "youtubeTemplate" TEXT NOT NULL,

    CONSTRAINT "TemplatePreferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TemplatePreferences_userId_key" ON "TemplatePreferences"("userId");

-- AddForeignKey
ALTER TABLE "TemplatePreferences" ADD CONSTRAINT "TemplatePreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
