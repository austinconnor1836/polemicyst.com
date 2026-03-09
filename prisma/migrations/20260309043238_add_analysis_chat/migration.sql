-- CreateTable
CREATE TABLE "AnalysisChat" (
    "id" TEXT NOT NULL,
    "feedVideoId" TEXT NOT NULL,
    "clipId" TEXT NOT NULL DEFAULT '__video__',
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalysisChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisChatMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCostUsd" DOUBLE PRECISION,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalysisChat_userId_idx" ON "AnalysisChat"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisChat_feedVideoId_clipId_key" ON "AnalysisChat"("feedVideoId", "clipId");

-- CreateIndex
CREATE INDEX "AnalysisChatMessage_chatId_idx" ON "AnalysisChatMessage"("chatId");

-- AddForeignKey
ALTER TABLE "AnalysisChat" ADD CONSTRAINT "AnalysisChat_feedVideoId_fkey" FOREIGN KEY ("feedVideoId") REFERENCES "account_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisChatMessage" ADD CONSTRAINT "AnalysisChatMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "AnalysisChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
