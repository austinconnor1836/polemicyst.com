-- Add status to feed videos for async download lifecycle
ALTER TABLE "FeedVideo"
ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ready';
