-- CreateTable
CREATE TABLE "TruthAnalysis" (
    "id" TEXT NOT NULL,
    "feedVideoId" TEXT NOT NULL,
    "clipId" TEXT NOT NULL DEFAULT '__video__',
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "result" JSONB,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCostUsd" DOUBLE PRECISION,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TruthAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TruthAnalysis_feedVideoId_idx" ON "TruthAnalysis"("feedVideoId");

-- CreateIndex
CREATE INDEX "TruthAnalysis_userId_idx" ON "TruthAnalysis"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TruthAnalysis_feedVideoId_clipId_key" ON "TruthAnalysis"("feedVideoId", "clipId");

-- AddForeignKey
ALTER TABLE "TruthAnalysis" ADD CONSTRAINT "TruthAnalysis_feedVideoId_fkey" FOREIGN KEY ("feedVideoId") REFERENCES "account_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
