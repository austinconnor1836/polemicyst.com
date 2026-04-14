-- AlterTable
ALTER TABLE "TrainingExample" ADD COLUMN     "userFeedbackCreatedAt" TIMESTAMP(3),
ADD COLUMN     "userFeedbackLabel" TEXT,
ADD COLUMN     "userFeedbackTrimEndS" DOUBLE PRECISION,
ADD COLUMN     "userFeedbackTrimStartS" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "ClipFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "feedVideoId" TEXT,
    "action" TEXT NOT NULL,
    "oldTrimStartS" DOUBLE PRECISION,
    "oldTrimEndS" DOUBLE PRECISION,
    "newTrimStartS" DOUBLE PRECISION,
    "newTrimEndS" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClipFeedback_userId_idx" ON "ClipFeedback"("userId");

-- CreateIndex
CREATE INDEX "ClipFeedback_clipId_idx" ON "ClipFeedback"("clipId");

-- CreateIndex
CREATE INDEX "ClipFeedback_feedVideoId_idx" ON "ClipFeedback"("feedVideoId");

-- CreateIndex
CREATE INDEX "ClipFeedback_action_idx" ON "ClipFeedback"("action");

-- CreateIndex
CREATE INDEX "ClipFeedback_createdAt_idx" ON "ClipFeedback"("createdAt");

-- AddForeignKey
ALTER TABLE "ClipFeedback" ADD CONSTRAINT "ClipFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipFeedback" ADD CONSTRAINT "ClipFeedback_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipFeedback" ADD CONSTRAINT "ClipFeedback_feedVideoId_fkey" FOREIGN KEY ("feedVideoId") REFERENCES "account_videos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
