-- CreateTable
CREATE TABLE "UsageMonth" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "processedMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clipCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageMonth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageMonth_userId_idx" ON "UsageMonth"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageMonth_userId_yearMonth_key" ON "UsageMonth"("userId", "yearMonth");

-- AddForeignKey
ALTER TABLE "UsageMonth" ADD CONSTRAINT "UsageMonth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
