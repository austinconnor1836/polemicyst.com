/**
 * Cloudflare R2 storage adapter.
 *
 * R2 exposes an S3-compatible API, so we drive it with the same
 * `@aws-sdk/client-s3` we already use for AWS S3. Key differences:
 *
 * - No region — R2 buckets are region-less. We pass `region: 'auto'`
 *   because the AWS SDK's SigV4 signer requires SOMETHING there;
 *   Cloudflare ignores it.
 * - Endpoint override — traffic goes to
 *   `https://<accountId>.r2.cloudflarestorage.com`, not AWS.
 * - Credentials are R2 API tokens (Access Key ID + Secret) minted in
 *   the Cloudflare dashboard under R2 → Manage R2 API Tokens.
 * - Presigned URLs work for both PUT (uploads) and GET (playback) via
 *   the same `@aws-sdk/s3-request-presigner` package.
 *
 * Public playback: R2 also supports "public buckets" via
 * `pub-<hash>.r2.dev` or a custom domain. For Clipfire we still use
 * presigned URLs because clip visibility is user-scoped.
 *
 * Env:
 *   R2_ACCOUNT_ID           — 32-char Cloudflare account id
 *   R2_BUCKET               — target bucket name
 *   R2_ACCESS_KEY_ID        — API token access key
 *   R2_SECRET_ACCESS_KEY    — API token secret
 *   R2_ENDPOINT             — optional override; default computed from accountId
 *   R2_PUBLIC_BASE_URL      — optional pub-<hash>.r2.dev URL if bucket is public
 *   S3_PREFIX               — same prefix semantics as S3StorageAdapter
 */

import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageProvider } from './storage-provider';
import { S3_PREFIX } from './storage-provider';

export const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
export const R2_BUCKET = process.env.R2_BUCKET || process.env.S3_BUCKET || '';
export const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
export const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
export const R2_ENDPOINT =
  process.env.R2_ENDPOINT ||
  (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '');
export const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL || '';

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    if (!R2_ENDPOINT) {
      throw new Error('R2 endpoint missing — set R2_ACCOUNT_ID or R2_ENDPOINT.');
    }
    if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      throw new Error('R2 credentials missing — set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.');
    }
    client = new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
      // R2 requires path-style addressing when hitting the account endpoint.
      forcePathStyle: true,
    });
  }
  return client;
}

/** Reset the cached client — used by tests. */
export function __resetR2Client(): void {
  client = null;
}

export class R2StorageAdapter implements StorageProvider {
  getKey(path: string): string {
    if (!path) return '';
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    if (S3_PREFIX && !cleanPath.startsWith(S3_PREFIX + '/')) {
      return `${S3_PREFIX}/${cleanPath}`;
    }
    return cleanPath;
  }

  stripPrefix(key: string): string {
    if (!key || !S3_PREFIX) return key;
    const prefix = `${S3_PREFIX}/`;
    if (key.startsWith(prefix)) {
      return key.slice(prefix.length);
    }
    return key;
  }

  async deleteObject(key: string): Promise<void> {
    if (!key) return;
    const objectKey = this.getKey(key);
    await getClient().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: objectKey }));
  }

  /**
   * Presigned GET URL (playback / download). Prefer this over public URLs
   * for user-scoped resources.
   */
  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const objectKey = this.getKey(key);
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: objectKey,
    });
    return awsGetSignedUrl(getClient(), command, {
      expiresIn: expiresInSeconds,
    });
  }

  /**
   * Presigned PUT URL for uploads. The mobile clients + web upload flow
   * currently hit S3 multipart via the SDK server-side; this is provided
   * for the simple single-shot upload path (image uploads, small assets).
   *
   * Multipart uploads on R2 work with `@aws-sdk/lib-storage` (`Upload`
   * class) exactly like S3 — no adapter change needed.
   */
  async getSignedUploadUrl(
    key: string,
    expiresInSeconds: number,
    contentType?: string
  ): Promise<string> {
    const objectKey = this.getKey(key);
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: objectKey,
      ...(contentType ? { ContentType: contentType } : {}),
    });
    return awsGetSignedUrl(getClient(), command, {
      expiresIn: expiresInSeconds,
    });
  }

  /**
   * Public URL for a key IF `R2_PUBLIC_BASE_URL` is set (bucket exposed
   * via `pub-<hash>.r2.dev` or a custom domain). Returns `null` when no
   * public base URL is configured.
   */
  getPublicUrl(key: string): string | null {
    if (!R2_PUBLIC_BASE_URL) return null;
    const objectKey = this.getKey(key);
    return `${R2_PUBLIC_BASE_URL.replace(/\/$/, '')}/${objectKey}`;
  }

  /** Expose the underlying S3-compatible client for advanced flows
   *  (multipart via `@aws-sdk/lib-storage`, direct commands, etc.). */
  getClient(): S3Client {
    return getClient();
  }
}
