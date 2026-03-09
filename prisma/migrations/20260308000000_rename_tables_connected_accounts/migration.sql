-- Rename tables to match the "Connected Accounts" rebrand.
-- Prisma model names (VideoFeed / FeedVideo) stay the same; @@map handles the mapping.
ALTER TABLE "VideoFeed" RENAME TO "connected_accounts";
ALTER TABLE "FeedVideo" RENAME TO "account_videos";
