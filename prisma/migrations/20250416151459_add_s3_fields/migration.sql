/*
  Warnings:

  - Added the required column `s3Key` to the `Video` table without a default value. This is not possible if the table is not empty.
  - Added the required column `s3Url` to the `Video` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "s3Key" TEXT NOT NULL,
ADD COLUMN     "s3Url" TEXT NOT NULL;
