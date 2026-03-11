-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "configMarkdown" TEXT NOT NULL,
    "configJson" JSONB,
    "substackUrl" TEXT,
    "substackConnected" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "bodyMarkdown" TEXT,
    "bodyHtml" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "sourceContext" JSONB,
    "generationModel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "substackPostId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "tags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleGraphic" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT,
    "htmlContent" TEXT,
    "s3Key" TEXT,
    "s3Url" TEXT,
    "config" JSONB,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleGraphic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Publication_userId_idx" ON "Publication"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_userId_name_key" ON "Publication"("userId", "name");

-- CreateIndex
CREATE INDEX "Article_publicationId_idx" ON "Article"("publicationId");

-- CreateIndex
CREATE INDEX "Article_userId_idx" ON "Article"("userId");

-- CreateIndex
CREATE INDEX "ArticleGraphic_articleId_idx" ON "ArticleGraphic"("articleId");

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleGraphic" ADD CONSTRAINT "ArticleGraphic_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
