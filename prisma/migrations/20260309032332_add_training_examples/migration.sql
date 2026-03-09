-- AlterTable
ALTER TABLE "account_videos" RENAME CONSTRAINT "FeedVideo_pkey" TO "account_videos_pkey";

-- AlterTable
ALTER TABLE "connected_accounts" RENAME CONSTRAINT "VideoFeed_pkey" TO "connected_accounts_pkey";

-- CreateTable
CREATE TABLE "TrainingExample" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "transcriptText" TEXT NOT NULL,
    "tStartS" DOUBLE PRECISION NOT NULL,
    "tEndS" DOUBLE PRECISION NOT NULL,
    "targetPlatform" TEXT NOT NULL DEFAULT 'all',
    "contentStyle" TEXT,
    "saferClips" BOOLEAN NOT NULL DEFAULT false,
    "includeAudio" BOOLEAN NOT NULL DEFAULT false,
    "frameCount" INTEGER NOT NULL DEFAULT 0,
    "audioSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "heuristicScore" DOUBLE PRECISION,
    "heuristicFeatures" JSONB,
    "llmScore" DOUBLE PRECISION NOT NULL,
    "hookScore" DOUBLE PRECISION,
    "contextScore" DOUBLE PRECISION,
    "captionabilityScore" DOUBLE PRECISION,
    "comedicScore" DOUBLE PRECISION,
    "provocativeScore" DOUBLE PRECISION,
    "visualEnergyScore" DOUBLE PRECISION,
    "audioEnergyScore" DOUBLE PRECISION,
    "riskScore" DOUBLE PRECISION,
    "riskFlags" JSONB,
    "hasViralMoment" BOOLEAN,
    "confidence" DOUBLE PRECISION,
    "rationale" TEXT,
    "finalScore" DOUBLE PRECISION NOT NULL,
    "wasSelected" BOOLEAN NOT NULL DEFAULT false,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCostUsd" DOUBLE PRECISION,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingExample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingExample_userId_idx" ON "TrainingExample"("userId");

-- CreateIndex
CREATE INDEX "TrainingExample_jobId_idx" ON "TrainingExample"("jobId");

-- CreateIndex
CREATE INDEX "TrainingExample_provider_idx" ON "TrainingExample"("provider");

-- CreateIndex
CREATE INDEX "TrainingExample_confidence_idx" ON "TrainingExample"("confidence");

-- CreateIndex
CREATE INDEX "TrainingExample_createdAt_idx" ON "TrainingExample"("createdAt");

-- RenameForeignKey
ALTER TABLE "account_videos" RENAME CONSTRAINT "FeedVideo_clipSourceVideoId_fkey" TO "account_videos_clipSourceVideoId_fkey";

-- RenameForeignKey
ALTER TABLE "account_videos" RENAME CONSTRAINT "FeedVideo_feedId_fkey" TO "account_videos_feedId_fkey";

-- RenameForeignKey
ALTER TABLE "account_videos" RENAME CONSTRAINT "FeedVideo_userId_fkey" TO "account_videos_userId_fkey";

-- RenameForeignKey
ALTER TABLE "connected_accounts" RENAME CONSTRAINT "VideoFeed_userId_fkey" TO "connected_accounts_userId_fkey";

-- RenameIndex
ALTER INDEX "FeedVideo_clipSourceVideoId_key" RENAME TO "account_videos_clipSourceVideoId_key";

-- RenameIndex
ALTER INDEX "FeedVideo_feedId_videoId_key" RENAME TO "account_videos_feedId_videoId_key";
