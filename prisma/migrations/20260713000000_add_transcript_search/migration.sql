-- Transcript search + one-click clip feature.
-- Adds two tables that persist the (user, query) tuples and their matching
-- transcript segments across FeedVideos, so a re-run of the same query
-- returns cached hits and each hit is a stable target for one-click clip
-- generation.

-- CreateTable
CREATE TABLE IF NOT EXISTS "TranscriptSearchQuery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "queryText" TEXT NOT NULL,
    "isRegex" BOOLEAN NOT NULL DEFAULT false,
    "wordBoundary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRunAt" TIMESTAMP(3),

    CONSTRAINT "TranscriptSearchQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TranscriptSearchHit" (
    "id" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "feedVideoId" TEXT NOT NULL,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION,
    "matchText" TEXT NOT NULL,
    "matchedSpan" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptSearchHit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TranscriptSearchQuery_userId_createdAt_idx"
    ON "TranscriptSearchQuery"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TranscriptSearchHit_queryId_idx"
    ON "TranscriptSearchHit"("queryId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TranscriptSearchHit_feedVideoId_idx"
    ON "TranscriptSearchHit"("feedVideoId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TranscriptSearchHit_queryId_feedVideoId_startSec_key"
    ON "TranscriptSearchHit"("queryId", "feedVideoId", "startSec");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'TranscriptSearchQuery_userId_fkey'
    ) THEN
        ALTER TABLE "TranscriptSearchQuery"
            ADD CONSTRAINT "TranscriptSearchQuery_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'TranscriptSearchHit_queryId_fkey'
    ) THEN
        ALTER TABLE "TranscriptSearchHit"
            ADD CONSTRAINT "TranscriptSearchHit_queryId_fkey"
            FOREIGN KEY ("queryId") REFERENCES "TranscriptSearchQuery"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'TranscriptSearchHit_feedVideoId_fkey'
    ) THEN
        ALTER TABLE "TranscriptSearchHit"
            ADD CONSTRAINT "TranscriptSearchHit_feedVideoId_fkey"
            FOREIGN KEY ("feedVideoId") REFERENCES "account_videos"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
