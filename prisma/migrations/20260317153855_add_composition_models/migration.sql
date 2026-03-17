-- CreateTable
CREATE TABLE "UploadLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "filename" TEXT,
    "key" TEXT,
    "uploadId" TEXT,
    "partNumber" INTEGER,
    "fileSize" INTEGER,
    "contentType" TEXT,
    "durationMs" INTEGER,
    "error" TEXT,
    "metadata" JSONB,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Composition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'pre-synced',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "audioMode" TEXT NOT NULL DEFAULT 'creator',
    "creatorVolume" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "referenceVolume" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "creatorS3Key" TEXT,
    "creatorS3Url" TEXT,
    "creatorDurationS" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Composition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompositionTrack" (
    "id" TEXT NOT NULL,
    "compositionId" TEXT NOT NULL,
    "label" TEXT,
    "s3Key" TEXT NOT NULL,
    "s3Url" TEXT NOT NULL,
    "durationS" DOUBLE PRECISION NOT NULL,
    "startAtS" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trimStartS" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trimEndS" DOUBLE PRECISION,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "hasAudio" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompositionTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompositionOutput" (
    "id" TEXT NOT NULL,
    "compositionId" TEXT NOT NULL,
    "layout" TEXT NOT NULL,
    "s3Key" TEXT,
    "s3Url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "renderError" TEXT,
    "durationMs" INTEGER,
    "fileSizeBytes" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompositionOutput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UploadLog_userId_idx" ON "UploadLog"("userId");

-- CreateIndex
CREATE INDEX "UploadLog_stage_idx" ON "UploadLog"("stage");

-- CreateIndex
CREATE INDEX "UploadLog_status_idx" ON "UploadLog"("status");

-- CreateIndex
CREATE INDEX "UploadLog_createdAt_idx" ON "UploadLog"("createdAt");

-- CreateIndex
CREATE INDEX "UploadLog_uploadId_idx" ON "UploadLog"("uploadId");

-- CreateIndex
CREATE INDEX "Composition_userId_idx" ON "Composition"("userId");

-- CreateIndex
CREATE INDEX "Composition_status_idx" ON "Composition"("status");

-- CreateIndex
CREATE INDEX "CompositionTrack_compositionId_idx" ON "CompositionTrack"("compositionId");

-- CreateIndex
CREATE INDEX "CompositionOutput_compositionId_idx" ON "CompositionOutput"("compositionId");

-- AddForeignKey
ALTER TABLE "UploadLog" ADD CONSTRAINT "UploadLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Composition" ADD CONSTRAINT "Composition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompositionTrack" ADD CONSTRAINT "CompositionTrack_compositionId_fkey" FOREIGN KEY ("compositionId") REFERENCES "Composition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompositionOutput" ADD CONSTRAINT "CompositionOutput_compositionId_fkey" FOREIGN KEY ("compositionId") REFERENCES "Composition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
