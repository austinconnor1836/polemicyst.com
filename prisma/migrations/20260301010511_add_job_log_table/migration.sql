-- CreateTable
CREATE TABLE "JobLog" (
    "id" TEXT NOT NULL,
    "feedVideoId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "error" TEXT,
    "durationMs" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobLog_feedVideoId_idx" ON "JobLog"("feedVideoId");

-- CreateIndex
CREATE INDEX "JobLog_jobType_idx" ON "JobLog"("jobType");

-- CreateIndex
CREATE INDEX "JobLog_status_idx" ON "JobLog"("status");

-- CreateIndex
CREATE INDEX "JobLog_createdAt_idx" ON "JobLog"("createdAt");

-- AddForeignKey
ALTER TABLE "JobLog" ADD CONSTRAINT "JobLog_feedVideoId_fkey" FOREIGN KEY ("feedVideoId") REFERENCES "FeedVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
