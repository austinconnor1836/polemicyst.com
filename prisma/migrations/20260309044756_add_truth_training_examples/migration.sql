-- CreateTable
CREATE TABLE "TruthTrainingExample" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feedVideoId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "type" TEXT NOT NULL,
    "transcriptText" TEXT NOT NULL,
    "analysisContext" JSONB,
    "conversationHistory" JSONB,
    "result" JSONB NOT NULL,
    "overallCredibility" DOUBLE PRECISION,
    "assertionCount" INTEGER,
    "fallacyCount" INTEGER,
    "biasCount" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCostUsd" DOUBLE PRECISION,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TruthTrainingExample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TruthTrainingExample_userId_idx" ON "TruthTrainingExample"("userId");

-- CreateIndex
CREATE INDEX "TruthTrainingExample_feedVideoId_idx" ON "TruthTrainingExample"("feedVideoId");

-- CreateIndex
CREATE INDEX "TruthTrainingExample_provider_idx" ON "TruthTrainingExample"("provider");

-- CreateIndex
CREATE INDEX "TruthTrainingExample_type_idx" ON "TruthTrainingExample"("type");

-- CreateIndex
CREATE INDEX "TruthTrainingExample_createdAt_idx" ON "TruthTrainingExample"("createdAt");
