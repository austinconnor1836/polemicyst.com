-- CreateTable
CREATE TABLE "LectureTrainingExample" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "sourceFilename" TEXT NOT NULL,
    "frameIntervalS" INTEGER NOT NULL,
    "sampledFrameCount" INTEGER NOT NULL,
    "extractedSlideCount" INTEGER NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCostUsd" DOUBLE PRECISION,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LectureTrainingExample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LectureTrainingExample_userId_idx" ON "LectureTrainingExample"("userId");

-- CreateIndex
CREATE INDEX "LectureTrainingExample_jobId_idx" ON "LectureTrainingExample"("jobId");

-- CreateIndex
CREATE INDEX "LectureTrainingExample_provider_idx" ON "LectureTrainingExample"("provider");

-- CreateIndex
CREATE INDEX "LectureTrainingExample_createdAt_idx" ON "LectureTrainingExample"("createdAt");
