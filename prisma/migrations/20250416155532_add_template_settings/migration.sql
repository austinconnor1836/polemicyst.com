-- CreateTable
CREATE TABLE "TemplateSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "facebookTemplate" TEXT NOT NULL,
    "instagramTemplate" TEXT NOT NULL,
    "youtubeTemplate" TEXT NOT NULL,
    "blueskyTemplate" TEXT NOT NULL,
    "twitterTemplate" TEXT NOT NULL,

    CONSTRAINT "TemplateSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TemplateSettings_userId_key" ON "TemplateSettings"("userId");

-- AddForeignKey
ALTER TABLE "TemplateSettings" ADD CONSTRAINT "TemplateSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
