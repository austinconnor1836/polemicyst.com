-- CreateTable
CREATE TABLE "CostEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "inputImages" INTEGER,
    "inputAudioS" DOUBLE PRECISION,
    "durationMs" INTEGER,
    "fileSizeBytes" BIGINT,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostEvent_userId_idx" ON "CostEvent"("userId");

-- CreateIndex
CREATE INDEX "CostEvent_jobId_idx" ON "CostEvent"("jobId");

-- CreateIndex
CREATE INDEX "CostEvent_createdAt_idx" ON "CostEvent"("createdAt");
