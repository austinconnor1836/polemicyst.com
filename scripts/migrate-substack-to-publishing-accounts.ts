/**
 * Data migration: copies Substack credentials from Publication rows
 * into the new PublishingAccount + ArticlePublish tables.
 *
 * Safe to run multiple times — skips existing accounts.
 *
 * Usage: npx tsx scripts/migrate-substack-to-publishing-accounts.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const publications = await prisma.publication.findMany({
    where: { substackCookieEnc: { not: null } },
    include: {
      articles: {
        where: { substackDraftId: { not: null } },
      },
    },
  });

  console.log(`Found ${publications.length} publications with Substack credentials`);

  for (const pub of publications) {
    // Check if account already exists for this user + subdomain
    const existing = await prisma.publishingAccount.findFirst({
      where: {
        userId: pub.userId,
        platform: 'substack',
        platformUrl: pub.substackUrl,
      },
    });

    if (existing) {
      console.log(`  Skipping "${pub.name}" — account already exists (${existing.id})`);
      continue;
    }

    // Extract subdomain from URL
    let subdomain: string | null = null;
    if (pub.substackUrl) {
      try {
        subdomain = new URL(pub.substackUrl).hostname.split('.')[0];
      } catch {
        // ignore
      }
    }

    const account = await prisma.publishingAccount.create({
      data: {
        userId: pub.userId,
        platform: 'substack',
        displayName: pub.name,
        subdomain,
        platformUrl: pub.substackUrl,
        platformAccountId: pub.substackPublicationId,
        credentialEnc: pub.substackCookieEnc,
        connected: pub.substackConnected,
      },
    });

    console.log(`  Created PublishingAccount ${account.id} for "${pub.name}"`);

    // Migrate article publish records
    for (const article of pub.articles) {
      await prisma.articlePublish.create({
        data: {
          articleId: article.id,
          publishingAccountId: account.id,
          platformDraftId: article.substackDraftId,
          platformPostId: article.substackPostId,
          status: article.status === 'published' ? 'published' : 'draft',
          publishedAt: article.publishedAt,
        },
      });
      console.log(`    Migrated article "${article.title}" publish record`);
    }
  }

  console.log('Done.');
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
