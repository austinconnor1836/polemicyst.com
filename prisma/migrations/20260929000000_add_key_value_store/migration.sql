-- CreateTable
CREATE TABLE IF NOT EXISTS "KeyValueStore" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeyValueStore_pkey" PRIMARY KEY ("key")
);
