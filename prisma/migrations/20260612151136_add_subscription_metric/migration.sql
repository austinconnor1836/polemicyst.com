-- CreateTable
CREATE TABLE IF NOT EXISTS "SubscriptionMetric" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "mrrCents" INTEGER NOT NULL DEFAULT 0,
    "arrCents" INTEGER NOT NULL DEFAULT 0,
    "activeSubscriptions" INTEGER NOT NULL DEFAULT 0,
    "creatorCount" INTEGER NOT NULL DEFAULT 0,
    "proCount" INTEGER NOT NULL DEFAULT 0,
    "agencyCount" INTEGER NOT NULL DEFAULT 0,
    "newSubscriptions" INTEGER NOT NULL DEFAULT 0,
    "churnedSubscriptions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionMetric_date_key" ON "SubscriptionMetric"("date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SubscriptionMetric_date_idx" ON "SubscriptionMetric"("date");
