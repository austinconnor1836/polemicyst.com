-- STEP 1: Add the new columns with a temporary default
ALTER TABLE "VideoFeed" ADD COLUMN "userId" TEXT DEFAULT '8d26afd8-2507-4ad0-b113-ddb7440ce732';
ALTER TABLE "FeedVideo" ADD COLUMN "userId" TEXT DEFAULT '8d26afd8-2507-4ad0-b113-ddb7440ce732';

-- STEP 2: Backfill existing rows
UPDATE "VideoFeed" SET "userId" = '8d26afd8-2507-4ad0-b113-ddb7440ce732' WHERE "userId" IS NULL;
UPDATE "FeedVideo" SET "userId" = '8d26afd8-2507-4ad0-b113-ddb7440ce732' WHERE "userId" IS NULL;

-- STEP 3: Alter column to be NOT NULL and remove default
ALTER TABLE "VideoFeed" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "VideoFeed" ALTER COLUMN "userId" DROP DEFAULT;

ALTER TABLE "FeedVideo" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "FeedVideo" ALTER COLUMN "userId" DROP DEFAULT;

-- STEP 4: Add foreign key constraints
ALTER TABLE "VideoFeed" ADD CONSTRAINT "VideoFeed_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeedVideo" ADD CONSTRAINT "FeedVideo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
