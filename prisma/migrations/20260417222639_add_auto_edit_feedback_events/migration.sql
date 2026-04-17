-- AlterTable
ALTER TABLE "AutomationRule" ADD COLUMN     "quoteGraphicStyle" TEXT NOT NULL DEFAULT 'pull-quote',
ADD COLUMN     "quoteGraphicsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Composition" ADD COLUMN     "detectedQuotes" JSONB,
ADD COLUMN     "quoteGraphicStyle" TEXT,
ADD COLUMN     "quoteGraphicsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CompositionTrack" ADD COLUMN     "trackType" TEXT NOT NULL DEFAULT 'reference';

-- CreateTable
CREATE TABLE "AutoEditFeedback" (
    "id" TEXT NOT NULL,
    "compositionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "aggressiveness" TEXT NOT NULL,
    "badTakeDetection" BOOLEAN NOT NULL,
    "minSilenceToKeepS" DOUBLE PRECISION NOT NULL,
    "minSilenceDurationS" DOUBLE PRECISION NOT NULL,
    "silenceThresholdDb" DOUBLE PRECISION NOT NULL,
    "totalCuts" INTEGER NOT NULL,
    "totalRemovedS" DOUBLE PRECISION NOT NULL,
    "triggerRender" BOOLEAN NOT NULL DEFAULT true,
    "feedbackSource" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutoEditFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutoEditFeedback_compositionId_idx" ON "AutoEditFeedback"("compositionId");

-- CreateIndex
CREATE INDEX "AutoEditFeedback_userId_idx" ON "AutoEditFeedback"("userId");

-- CreateIndex
CREATE INDEX "AutoEditFeedback_action_idx" ON "AutoEditFeedback"("action");

-- CreateIndex
CREATE INDEX "AutoEditFeedback_createdAt_idx" ON "AutoEditFeedback"("createdAt");

-- AddForeignKey
ALTER TABLE "AutoEditFeedback" ADD CONSTRAINT "AutoEditFeedback_compositionId_fkey" FOREIGN KEY ("compositionId") REFERENCES "Composition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoEditFeedback" ADD CONSTRAINT "AutoEditFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
