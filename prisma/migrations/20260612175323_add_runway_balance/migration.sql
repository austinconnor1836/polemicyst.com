-- CreateTable
CREATE TABLE "RunwayBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "bankBalanceCents" INTEGER NOT NULL,
    "revenueLast30dCents" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunwayBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RunwayBalance_asOfDate_key" ON "RunwayBalance"("asOfDate");

-- CreateIndex
CREATE INDEX "RunwayBalance_asOfDate_idx" ON "RunwayBalance"("asOfDate");
