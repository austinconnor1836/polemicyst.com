-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "defaultPublishPlatforms" JSONB;

-- CreateTable
CREATE TABLE IF NOT EXISTS "SocialPost" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "platforms" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SocialPostPublish" (
    "id" TEXT NOT NULL,
    "socialPostId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "platformPostId" TEXT,
    "platformUrl" TEXT,
    "publishError" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPostPublish_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SocialPost_userId_idx" ON "SocialPost"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SocialPost_createdAt_idx" ON "SocialPost"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SocialPostPublish_socialPostId_idx" ON "SocialPostPublish"("socialPostId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SocialPostPublish_platform_idx" ON "SocialPostPublish"("platform");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SocialPostPublish_socialPostId_platform_key" ON "SocialPostPublish"("socialPostId", "platform");

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostPublish" ADD CONSTRAINT "SocialPostPublish_socialPostId_fkey" FOREIGN KEY ("socialPostId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
