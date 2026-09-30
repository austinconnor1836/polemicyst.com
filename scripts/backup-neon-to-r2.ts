#!/usr/bin/env -S npx ts-node
/**
 * Weekly Neon → R2 offsite backup.
 *
 * Runs from GitHub Actions cron. Complements Neon's built-in PITR (point-in-time
 * recovery — 7 days on Pro) with an outside-the-vendor snapshot in R2. If Neon has a
 * total-account catastrophe, PITR is gone; the R2 dump remains.
 *
 * WHAT IT DOES
 *   1. Runs `pg_dump` against `$DIRECT_DATABASE_URL` (unpooled — pg_dump doesn't work
 *      through pgbouncer transaction mode) producing a custom-format (-Fc) dump.
 *   2. gzips the dump.
 *   3. Uploads to R2 at `s3://<S3_BUCKET>/backups/neon/<yyyy-mm-dd>.dump.gz`.
 *   4. Prints the object key + size. On failure, exits non-zero so the cron alerts.
 *
 * WHY custom-format (-Fc)
 *   Restores via `pg_restore --clean --if-exists` cleanly, supports selective table
 *   restore, and is denser than plain SQL. `.dump.gz` is what every Postgres operator
 *   expects.
 *
 * ENV
 *   DIRECT_DATABASE_URL — unpooled Neon URL. `pg_dump` requires this.
 *   S3_BUCKET — R2 bucket for backups (may be the same as our media bucket; the `backups/`
 *               prefix keeps them separate). Recommend a dedicated bucket
 *               `polemicyst-backups` with a lifecycle rule (keep 12 weeks).
 *   S3_ENDPOINT — R2 API endpoint, e.g. https://<account>.r2.cloudflarestorage.com
 *   S3_REGION — 'auto' for R2.
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY — R2 credentials with `Object:Write` on
 *                                                the bucket.
 *
 * INVOCATION
 *   Locally: `DIRECT_DATABASE_URL=... S3_BUCKET=... S3_ENDPOINT=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... npx ts-node scripts/backup-neon-to-r2.ts`
 *   CI: `.github/workflows/backup-neon.yml` (owner: data-plane agent; not shipped here).
 *
 * PORTABILITY: this file is designed to run in Node 20 with `ts-node`. The one native
 * binary it needs is `pg_dump` — the GitHub Actions runner image (`ubuntu-latest`)
 * ships it under `/usr/bin/pg_dump` (postgresql-client-16).
 */

import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

async function main(): Promise<void> {
  const databaseUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  const bucket = process.env.S3_BUCKET;
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION || 'auto';

  if (!databaseUrl) throw new Error('DIRECT_DATABASE_URL (or DATABASE_URL) is required');
  if (!bucket) throw new Error('S3_BUCKET is required');
  if (!endpoint) throw new Error('S3_ENDPOINT is required — R2 needs a custom endpoint');

  const stamp = new Date().toISOString().slice(0, 10); // yyyy-mm-dd
  const dumpPath = join(tmpdir(), `neon-${stamp}.dump`);
  const gzPath = join(tmpdir(), `neon-${stamp}.dump.gz`);

  console.log(`[backup] pg_dump → ${dumpPath}`);
  await runPgDump(databaseUrl, dumpPath);

  console.log(`[backup] gzip → ${gzPath}`);
  await gzipFile(dumpPath, gzPath);

  const sizeBytes = statSync(gzPath).size;
  console.log(`[backup] gz size: ${(sizeBytes / (1024 * 1024)).toFixed(1)} MiB`);

  const key = `backups/neon/${stamp}.dump.gz`;
  console.log(`[backup] upload → s3://${bucket}/${key}`);
  await uploadToR2({ bucket, key, filePath: gzPath, endpoint, region });

  // Clean up the temp files. On failure this is a no-op — the runner tears down anyway.
  try {
    unlinkSync(dumpPath);
    unlinkSync(gzPath);
  } catch {
    /* ignore */
  }

  console.log(`[backup] done: s3://${bucket}/${key} (${sizeBytes} bytes)`);
}

function runPgDump(databaseUrl: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // -Fc = custom format; -Z 0 = no built-in compression (we gzip in the next stage
    // for better ratio + streaming); -f = output file. --no-owner + --no-privileges keep
    // the dump portable across Neon projects during recovery.
    const proc = spawn(
      'pg_dump',
      ['-Fc', '-Z', '0', '--no-owner', '--no-privileges', '-f', outPath, databaseUrl],
      { stdio: ['ignore', 'inherit', 'inherit'] }
    );
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited with code ${code}`));
    });
  });
}

async function gzipFile(inPath: string, outPath: string): Promise<void> {
  await pipeline(createReadStream(inPath), createGzip({ level: 9 }), createWriteStream(outPath));
}

async function uploadToR2(args: {
  bucket: string;
  key: string;
  filePath: string;
  endpoint: string;
  region: string;
}): Promise<void> {
  // Delay-loaded to keep the top-level script snappy on `--help` runs.
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: args.region,
    endpoint: args.endpoint,
    forcePathStyle: true, // R2 requires path-style addressing.
  });
  const body = createReadStream(args.filePath);
  await client.send(
    new PutObjectCommand({
      Bucket: args.bucket,
      Key: args.key,
      Body: body,
      ContentType: 'application/gzip',
      ContentEncoding: 'gzip',
    })
  );
}

main().catch((err) => {
  console.error('[backup] FAILED:', err);
  process.exit(1);
});
