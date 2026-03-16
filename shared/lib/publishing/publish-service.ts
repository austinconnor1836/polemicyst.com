import { prisma } from '../prisma';
import { SubstackClient } from './substack-client';
import { SubstackError } from './errors';
import { encryptCookie, decryptCookie } from './crypto';
import { markdownToProseMirrorDoc } from './markdown-to-prosemirror';
import { rasterizeGraphic, getGraphicDimensions } from './rasterize';
import { getS3Key } from '../s3';
import AWS from 'aws-sdk';

const S3_BUCKET = process.env.S3_BUCKET || 'clips-genie-uploads';
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';
const s3 = new AWS.S3({ region: S3_REGION });

export class PublishService {
  // ── Publishing Account Methods ──

  /**
   * Connect a new publishing account by verifying credentials and storing them.
   */
  async connectAccount(
    userId: string,
    platform: string,
    credentials: { cookie: string; subdomain?: string }
  ) {
    if (platform !== 'substack') {
      throw new Error(`Platform "${platform}" is not yet supported`);
    }

    // If no subdomain provided (e.g. iOS — can't extract from browser due to CSRF),
    // discover it server-side using the session cookie.
    const subdomain =
      credentials.subdomain || (await SubstackClient.discoverSubdomain(credentials.cookie));

    // If the cookie is a full "name=value; name=value" string (iOS sends all cookies),
    // extract just the substack.sid value for storage and SubstackClient usage.
    let sessionCookieValue = credentials.cookie;
    if (credentials.cookie.includes('=')) {
      const match = credentials.cookie.match(/substack\.sid=([^;]+)/);
      if (match) {
        sessionCookieValue = match[1].trim();
      }
    }

    const client = new SubstackClient(subdomain, sessionCookieValue);
    const result = await client.verifyConnection();

    const encrypted = encryptCookie(sessionCookieValue);

    const account = await prisma.publishingAccount.create({
      data: {
        userId,
        platform,
        displayName: result.publicationName,
        subdomain,
        platformUrl: `https://${subdomain}.substack.com`,
        platformAccountId: String(result.publicationId),
        credentialEnc: encrypted,
        connected: true,
      },
    });

    return account;
  }

  /**
   * Verify a publishing account's credential is still valid.
   */
  async verifyAccount(
    accountId: string,
    userId: string
  ): Promise<{ connected: boolean; expired: boolean }> {
    const account = await prisma.publishingAccount.findFirst({
      where: { id: accountId, userId },
    });

    if (!account?.credentialEnc || !account.subdomain) {
      return { connected: false, expired: false };
    }

    try {
      const cookie = decryptCookie(account.credentialEnc);
      const client = new SubstackClient(account.subdomain, cookie);
      await client.verifyConnection();
      return { connected: true, expired: false };
    } catch (err) {
      if (err instanceof SubstackError && err.code === 'auth_expired') {
        await prisma.publishingAccount.update({
          where: { id: accountId },
          data: { connected: false },
        });
        return { connected: false, expired: true };
      }
      throw err;
    }
  }

  /**
   * Delete a publishing account.
   */
  async deleteAccount(accountId: string, userId: string): Promise<void> {
    const account = await prisma.publishingAccount.findFirst({
      where: { id: accountId, userId },
    });
    if (!account) {
      throw new Error('Publishing account not found');
    }
    await prisma.publishingAccount.delete({ where: { id: accountId } });
  }

  // ── Legacy Publication-Level Methods (kept for backwards compat) ──

  /**
   * Connect a publication to Substack by verifying and storing the session cookie.
   */
  async connectSubstack(
    publicationId: string,
    userId: string,
    cookie: string,
    subdomain: string
  ): Promise<{ publicationName: string }> {
    const publication = await prisma.publication.findFirst({
      where: { id: publicationId, userId },
    });
    if (!publication) {
      throw new Error('Publication not found');
    }

    // Verify the cookie works
    const client = new SubstackClient(subdomain, cookie);
    const result = await client.verifyConnection();

    // Encrypt and store
    const encrypted = encryptCookie(cookie);

    await prisma.publication.update({
      where: { id: publicationId },
      data: {
        substackCookieEnc: encrypted,
        substackPublicationId: String(result.publicationId),
        substackConnected: true,
        substackUrl: `https://${subdomain}.substack.com`,
      },
    });

    return { publicationName: result.publicationName };
  }

  /**
   * Disconnect Substack from a publication.
   */
  async disconnectSubstack(publicationId: string, userId: string): Promise<void> {
    const publication = await prisma.publication.findFirst({
      where: { id: publicationId, userId },
    });
    if (!publication) {
      throw new Error('Publication not found');
    }

    await prisma.publication.update({
      where: { id: publicationId },
      data: {
        substackCookieEnc: null,
        substackPublicationId: null,
        substackConnected: false,
      },
    });
  }

  /**
   * Verify the Substack connection is still valid.
   */
  async verifySubstack(
    publicationId: string,
    userId: string
  ): Promise<{ connected: boolean; expired: boolean }> {
    const publication = await prisma.publication.findFirst({
      where: { id: publicationId, userId },
    });

    if (!publication?.substackCookieEnc || !publication.substackUrl) {
      return { connected: false, expired: false };
    }

    try {
      const cookie = decryptCookie(publication.substackCookieEnc);
      const subdomain = new URL(publication.substackUrl).hostname.split('.')[0];
      const client = new SubstackClient(subdomain, cookie);
      await client.verifyConnection();
      return { connected: true, expired: false };
    } catch (err) {
      if (err instanceof SubstackError && err.code === 'auth_expired') {
        // Clear the expired cookie
        await prisma.publication.update({
          where: { id: publicationId },
          data: { substackConnected: false },
        });
        return { connected: false, expired: true };
      }
      throw err;
    }
  }

  // ── Publish Methods ──

  /**
   * Publish an article to a specific PublishingAccount (new flow).
   */
  async publishToAccount(
    articleId: string,
    userId: string,
    publishingAccountId: string,
    publishLive: boolean
  ) {
    const article = await prisma.article.findFirst({
      where: { id: articleId, userId },
      include: {
        publication: true,
        graphics: { orderBy: { position: 'asc' } },
      },
    });

    if (!article) throw new Error('Article not found');
    if (!article.bodyMarkdown) throw new Error('Article has no content to publish');

    const account = await prisma.publishingAccount.findFirst({
      where: { id: publishingAccountId, userId },
    });

    if (!account) throw new Error('Publishing account not found');
    if (!account.credentialEnc || !account.subdomain) {
      throw new Error('Publishing account is not properly connected');
    }

    if (account.platform !== 'substack') {
      throw new Error(`Publishing to ${account.platform} is not yet supported`);
    }

    // Upsert the ArticlePublish record
    let articlePublish = await prisma.articlePublish.upsert({
      where: {
        articleId_publishingAccountId: { articleId, publishingAccountId },
      },
      create: {
        articleId,
        publishingAccountId,
        status: 'draft',
      },
      update: {
        publishError: null,
      },
    });

    try {
      const cookie = decryptCookie(account.credentialEnc);
      const client = new SubstackClient(account.subdomain, cookie);

      // Step 1: Rasterize un-rasterized graphics
      const unreastered = article.graphics.filter((g) => g.htmlContent && !g.s3Url);
      for (const graphic of unreastered) {
        const dims = getGraphicDimensions(graphic.type);
        const pngBuffer = await rasterizeGraphic(graphic.htmlContent!, dims);
        const s3Path = `publications/${article.publicationId}/graphics/${graphic.id}.png`;
        const s3KeyVal = getS3Key(s3Path);

        await s3
          .putObject({
            Bucket: S3_BUCKET,
            Key: s3KeyVal,
            Body: pngBuffer,
            ContentType: 'image/png',
          })
          .promise();

        const s3Url = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${s3KeyVal}`;
        await prisma.articleGraphic.update({
          where: { id: graphic.id },
          data: { s3Key: s3KeyVal, s3Url },
        });
        graphic.s3Url = s3Url;
      }

      // Step 2: Upload graphics to Substack CDN
      const cdnUrls: Record<string, string> = {};
      for (const graphic of article.graphics) {
        if (!graphic.s3Url) continue;
        const s3Obj = await s3.getObject({ Bucket: S3_BUCKET, Key: graphic.s3Key! }).promise();
        const cdnUrl = await client.uploadImage(s3Obj.Body as Buffer, `${graphic.id}.png`);
        cdnUrls[graphic.id] = cdnUrl;
      }

      // Step 3: Convert markdown → ProseMirror
      let processedMarkdown = article.bodyMarkdown;
      for (const graphic of article.graphics) {
        if (graphic.s3Url && cdnUrls[graphic.id]) {
          processedMarkdown = processedMarkdown.replace(graphic.s3Url, cdnUrls[graphic.id]);
        }
      }
      const proseMirrorBody = markdownToProseMirrorDoc(processedMarkdown);

      // Step 4: Create or update draft
      const draftInput = {
        title: article.title,
        subtitle: article.subtitle || undefined,
        body: proseMirrorBody as unknown as Record<string, unknown>,
      };

      let draftId = articlePublish.platformDraftId;

      if (draftId) {
        await client.updateDraft(draftId, draftInput);
      } else {
        const draft = await client.createDraft(draftInput);
        draftId = String(draft.id);
      }

      // Step 5: Optionally publish live
      if (publishLive) {
        await client.publishDraft(draftId);
      }

      // Step 6: Update ArticlePublish record
      articlePublish = await prisma.articlePublish.update({
        where: { id: articlePublish.id },
        data: {
          platformDraftId: draftId,
          platformPostId: publishLive ? draftId : undefined,
          platformUrl: `https://${account.subdomain}.substack.com/p/${draftId}`,
          status: publishLive ? 'published' : 'draft',
          publishedAt: publishLive ? new Date() : undefined,
          publishError: null,
        },
      });

      // Also update the article status if published live
      if (publishLive) {
        await prisma.article.update({
          where: { id: articleId },
          data: {
            status: 'published',
            publishedAt: new Date(),
            substackDraftId: draftId,
            substackPostId: draftId,
            publishError: null,
          },
        });
      } else {
        await prisma.article.update({
          where: { id: articleId },
          data: {
            substackDraftId: draftId,
            publishError: null,
          },
        });
      }

      return articlePublish;
    } catch (err) {
      const errorMessage =
        err instanceof SubstackError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unknown publish error';

      await prisma.articlePublish.update({
        where: { id: articlePublish.id },
        data: {
          status: 'failed',
          publishError: errorMessage,
        },
      });

      if (err instanceof SubstackError && err.code === 'auth_expired') {
        await prisma.publishingAccount.update({
          where: { id: publishingAccountId },
          data: { connected: false },
        });
      }

      throw err;
    }
  }

  /**
   * Publish an article to Substack (legacy — via Publication).
   */
  async publishArticle(articleId: string, userId: string, publishLive: boolean) {
    const article = await prisma.article.findFirst({
      where: { id: articleId, userId },
      include: {
        publication: true,
        graphics: { orderBy: { position: 'asc' } },
      },
    });

    if (!article) {
      throw new Error('Article not found');
    }

    if (!article.bodyMarkdown) {
      throw new Error('Article has no content to publish');
    }

    const publication = article.publication;
    if (!publication.substackCookieEnc || !publication.substackUrl) {
      throw new Error('Substack is not connected for this publication');
    }

    // Clear any previous publish error
    await prisma.article.update({
      where: { id: articleId },
      data: { publishError: null },
    });

    try {
      const cookie = decryptCookie(publication.substackCookieEnc);
      const subdomain = new URL(publication.substackUrl).hostname.split('.')[0];
      const client = new SubstackClient(subdomain, cookie);

      // Step 1: Rasterize any un-rasterized graphics
      const unreastered = article.graphics.filter((g) => g.htmlContent && !g.s3Url);
      for (const graphic of unreastered) {
        const dims = getGraphicDimensions(graphic.type);
        const pngBuffer = await rasterizeGraphic(graphic.htmlContent!, dims);
        const s3Path = `publications/${publication.id}/graphics/${graphic.id}.png`;
        const s3KeyVal = getS3Key(s3Path);

        await s3
          .putObject({
            Bucket: S3_BUCKET,
            Key: s3KeyVal,
            Body: pngBuffer,
            ContentType: 'image/png',
          })
          .promise();

        const s3Url = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${s3KeyVal}`;
        await prisma.articleGraphic.update({
          where: { id: graphic.id },
          data: { s3Key: s3KeyVal, s3Url },
        });
        graphic.s3Url = s3Url;
      }

      // Step 2: Upload graphics to Substack CDN
      const cdnUrls: Record<string, string> = {};
      for (const graphic of article.graphics) {
        if (!graphic.s3Url) continue;
        // Download from S3 and upload to Substack
        const s3Obj = await s3
          .getObject({
            Bucket: S3_BUCKET,
            Key: graphic.s3Key!,
          })
          .promise();

        const cdnUrl = await client.uploadImage(s3Obj.Body as Buffer, `${graphic.id}.png`);
        cdnUrls[graphic.id] = cdnUrl;
      }

      // Step 3: Convert markdown → ProseMirror JSON
      // Replace S3 URLs with Substack CDN URLs in the markdown
      let processedMarkdown = article.bodyMarkdown;
      for (const graphic of article.graphics) {
        if (graphic.s3Url && cdnUrls[graphic.id]) {
          processedMarkdown = processedMarkdown.replace(graphic.s3Url, cdnUrls[graphic.id]);
        }
      }

      const proseMirrorBody = markdownToProseMirrorDoc(processedMarkdown);

      // Step 4: Create or update draft on Substack
      const draftInput = {
        title: article.title,
        subtitle: article.subtitle || undefined,
        body: proseMirrorBody as unknown as Record<string, unknown>,
      };

      let draftId = article.substackDraftId;

      if (draftId) {
        await client.updateDraft(draftId, draftInput);
      } else {
        const draft = await client.createDraft(draftInput);
        draftId = String(draft.id);
      }

      // Step 5: Optionally publish live
      if (publishLive) {
        await client.publishDraft(draftId);
      }

      // Step 6: Update article record
      const updateData: Record<string, unknown> = {
        substackDraftId: draftId,
        publishError: null,
      };

      if (publishLive) {
        updateData.status = 'published';
        updateData.publishedAt = new Date();
        updateData.substackPostId = draftId;
      }

      const updated = await prisma.article.update({
        where: { id: articleId },
        data: updateData,
        include: {
          publication: true,
          graphics: { orderBy: { position: 'asc' } },
        },
      });

      return updated;
    } catch (err) {
      const errorMessage =
        err instanceof SubstackError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unknown publish error';

      await prisma.article.update({
        where: { id: articleId },
        data: { publishError: errorMessage },
      });

      if (err instanceof SubstackError && err.code === 'auth_expired') {
        await prisma.publication.update({
          where: { id: publication.id },
          data: { substackConnected: false },
        });
      }

      throw err;
    }
  }
}
