-- CreateTable
CREATE TABLE "PublishingAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "subdomain" TEXT,
    "platformUrl" TEXT,
    "platformAccountId" TEXT,
    "credentialEnc" TEXT,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticlePublish" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "publishingAccountId" TEXT NOT NULL,
    "platformDraftId" TEXT,
    "platformPostId" TEXT,
    "platformUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishError" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticlePublish_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublishingAccount_userId_idx" ON "PublishingAccount"("userId");

-- CreateIndex
CREATE INDEX "ArticlePublish_articleId_idx" ON "ArticlePublish"("articleId");

-- CreateIndex
CREATE INDEX "ArticlePublish_publishingAccountId_idx" ON "ArticlePublish"("publishingAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticlePublish_articleId_publishingAccountId_key" ON "ArticlePublish"("articleId", "publishingAccountId");

-- AddForeignKey
ALTER TABLE "PublishingAccount" ADD CONSTRAINT "PublishingAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticlePublish" ADD CONSTRAINT "ArticlePublish_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticlePublish" ADD CONSTRAINT "ArticlePublish_publishingAccountId_fkey" FOREIGN KEY ("publishingAccountId") REFERENCES "PublishingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
