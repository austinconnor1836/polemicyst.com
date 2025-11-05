-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "tStartS" DOUBLE PRECISION NOT NULL,
    "tEndS" DOUBLE PRECISION NOT NULL,
    "features" JSONB NOT NULL,
    "llmNotes" JSONB,
    "score" DOUBLE PRECISION NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clip" (
    "id" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "s3Key" TEXT,
    "title" TEXT,
    "description" TEXT,
    "hashtags" TEXT,
    "publishMap" JSONB,

    CONSTRAINT "Clip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Metric" (
    "id" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL,
    "views3s" INTEGER NOT NULL,
    "views30s" INTEGER NOT NULL,
    "avgWatchS" DOUBLE PRECISION NOT NULL,
    "ctr" DOUBLE PRECISION NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Metric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Segment_videoId_idx" ON "Segment"("videoId");

-- CreateIndex
CREATE INDEX "Segment_score_idx" ON "Segment"("score");

-- CreateIndex
CREATE INDEX "Clip_segmentId_idx" ON "Clip"("segmentId");

-- CreateIndex
CREATE INDEX "Metric_clipId_idx" ON "Metric"("clipId");

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Metric" ADD CONSTRAINT "Metric_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
