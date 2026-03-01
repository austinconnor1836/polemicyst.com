-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "autoGenerateClips" BOOLEAN NOT NULL DEFAULT true,
    "viralitySettings" JSONB,
    "captionsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "captionStyle" TEXT NOT NULL DEFAULT 'default',
    "aspectRatio" TEXT NOT NULL DEFAULT '9:16',
    "cropTemplateId" TEXT,
    "autoPublish" BOOLEAN NOT NULL DEFAULT false,
    "publishPlatforms" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRule_userId_key" ON "AutomationRule"("userId");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
