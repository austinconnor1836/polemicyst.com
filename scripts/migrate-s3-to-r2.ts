#!/usr/bin/env tsx
/**
 * S3 → R2 object migration.
 *
 * Streams every object from an S3 bucket into R2 using the S3-compatible
 * PUT path (R2 is S3-API compatible so we just re-target the same
 * `@aws-sdk/client-s3` client). Resumable via a JSON manifest on disk:
 * completed keys are recorded and skipped on re-run.
 *
 * Usage:
 *   npx tsx scripts/migrate-s3-to-r2.ts \
 *     --src-bucket clips-genie-uploads \
 *     --src-region us-east-2 \
 *     --dst-bucket clipfire-uploads \
 *     --manifest ./tmp/migrate-s3-to-r2.manifest.json
 *
 * Env required:
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY — for the S3 read side.
 *   R2_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY — for R2 write side.
 *
 * Strategy:
 *   - `ListObjectsV2` paginated, 1000 keys/page.
 *   - For each key: check manifest → skip if done → GET from S3 → PUT to R2.
 *   - Verify content-length matches. ETag comparison is *advisory* only
 *     because MD5 ETags don't survive re-encoding through multipart uploads
 *     on either side.
 *   - Flush manifest to disk every 25 keys so a crash/kill loses at most 25
 *     of work.
 *
 * Alternative: `rclone copy s3:src r2:dst` does the same thing with parallel
 * workers and a native `--checksum` verify. If you have rclone installed,
 * prefer it for the bulk pass; this script is here for reproducibility +
 * running inside CI where rclone isn't installed.
 */

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';

interface Manifest {
  srcBucket: string;
  dstBucket: string;
  startedAt: string;
  updatedAt: string;
  completedKeys: string[];
  failedKeys: { key: string; error: string }[];
  totalBytes: number;
  totalObjects: number;
}

interface Args {
  srcBucket: string;
  srcRegion: string;
  dstBucket: string;
  manifestPath: string;
  prefix?: string;
  dryRun: boolean;
  multipartThresholdBytes: number;
}

function parseArgs(argv: string[]): Args {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag.startsWith('--')) {
      const key = flag.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  return {
    srcBucket: args['src-bucket'] || process.env.S3_BUCKET || '',
    srcRegion: args['src-region'] || process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1',
    dstBucket: args['dst-bucket'] || process.env.R2_BUCKET || '',
    manifestPath: args['manifest'] || './tmp/migrate-s3-to-r2.manifest.json',
    prefix: args['prefix'] || undefined,
    dryRun: args['dry-run'] === 'true',
    multipartThresholdBytes: parseInt(args['multipart-threshold'] || '', 10) || 100 * 1024 * 1024, // 100MB
  };
}

function loadManifest(p: string, args: Args): Manifest {
  if (fs.existsSync(p)) {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as Manifest;
    if (raw.srcBucket !== args.srcBucket || raw.dstBucket !== args.dstBucket) {
      throw new Error(
        `Manifest at ${p} was for src=${raw.srcBucket} dst=${raw.dstBucket}, ` +
          `not the buckets you're passing now. Delete it or use a different --manifest path.`
      );
    }
    return raw;
  }
  return {
    srcBucket: args.srcBucket,
    dstBucket: args.dstBucket,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedKeys: [],
    failedKeys: [],
    totalBytes: 0,
    totalObjects: 0,
  };
}

function saveManifest(p: string, m: Manifest): void {
  m.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(m, null, 2));
}

function makeS3Client(region: string): S3Client {
  return new S3Client({
    region,
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
}

function makeR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accountId) throw new Error('R2_ACCOUNT_ID env var required.');
  if (!process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
    throw new Error('R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY env vars required.');
  }
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
}

async function migrateOne(
  s3: S3Client,
  r2: S3Client,
  args: Args,
  key: string,
  size: number
): Promise<void> {
  // Fetch from source.
  const src = await s3.send(new GetObjectCommand({ Bucket: args.srcBucket, Key: key }));
  if (!src.Body) throw new Error(`no body for src ${key}`);
  const body = src.Body as Readable;
  const contentType = src.ContentType;
  const contentLength = src.ContentLength;

  if (size >= args.multipartThresholdBytes) {
    // Multipart (lib-storage handles all the plumbing).
    const upload = new Upload({
      client: r2,
      params: {
        Bucket: args.dstBucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      },
      queueSize: 4,
      partSize: 8 * 1024 * 1024,
    });
    await upload.done();
  } else {
    // Small object — collect + PUT.
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.from(chunk));
    }
    const buf = Buffer.concat(chunks);
    if (contentLength && buf.length !== contentLength) {
      throw new Error(`src content-length ${contentLength} !== buffered ${buf.length} for ${key}`);
    }
    await r2.send(
      new PutObjectCommand({
        Bucket: args.dstBucket,
        Key: key,
        Body: buf,
        ContentType: contentType,
      })
    );
  }

  // Verify by HEAD on the destination.
  const head = await r2.send(new HeadObjectCommand({ Bucket: args.dstBucket, Key: key }));
  if (
    typeof head.ContentLength === 'number' &&
    typeof contentLength === 'number' &&
    head.ContentLength !== contentLength
  ) {
    throw new Error(`dst content-length ${head.ContentLength} !== src ${contentLength} for ${key}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.srcBucket || !args.dstBucket) {
    console.error(
      'Usage: migrate-s3-to-r2.ts --src-bucket <s3> --src-region <region> --dst-bucket <r2>'
    );
    process.exit(1);
  }
  console.log(
    `[migrate] src=s3://${args.srcBucket}@${args.srcRegion} dst=r2://${args.dstBucket} ` +
      `manifest=${args.manifestPath} dryRun=${args.dryRun}`
  );

  const manifest = loadManifest(args.manifestPath, args);
  const completed = new Set(manifest.completedKeys);
  const s3 = makeS3Client(args.srcRegion);
  const r2 = args.dryRun ? s3 /* unused */ : makeR2Client();

  let continuationToken: string | undefined = undefined;
  let sinceFlush = 0;

  do {
    const listResp: ListObjectsV2CommandOutput = await s3.send(
      new ListObjectsV2Command({
        Bucket: args.srcBucket,
        Prefix: args.prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      })
    );
    continuationToken = listResp.IsTruncated ? listResp.NextContinuationToken : undefined;

    const contents = listResp.Contents || [];
    for (const obj of contents) {
      const key = obj.Key;
      if (!key) continue;
      if (completed.has(key)) continue;

      const size = obj.Size ?? 0;
      if (args.dryRun) {
        console.log(`[dry-run] would copy ${key} (${size} bytes)`);
        continue;
      }

      try {
        await migrateOne(s3, r2, args, key, size);
        manifest.completedKeys.push(key);
        completed.add(key);
        manifest.totalBytes += size;
        manifest.totalObjects += 1;
        sinceFlush += 1;
        if (sinceFlush >= 25) {
          saveManifest(args.manifestPath, manifest);
          sinceFlush = 0;
          console.log(
            `[migrate] progress: ${manifest.totalObjects} objects, ${(
              manifest.totalBytes /
              1024 /
              1024
            ).toFixed(1)} MB`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[migrate] FAIL ${key}: ${msg}`);
        manifest.failedKeys.push({ key, error: msg });
        saveManifest(args.manifestPath, manifest);
        sinceFlush = 0;
      }
    }
  } while (continuationToken);

  saveManifest(args.manifestPath, manifest);
  console.log(
    `[migrate] done. ${manifest.totalObjects} objects copied, ` +
      `${manifest.failedKeys.length} failed. Manifest at ${args.manifestPath}.`
  );
  if (manifest.failedKeys.length > 0) {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('[migrate] fatal:', err);
  process.exit(1);
});
