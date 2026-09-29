import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CHECK_TIMEOUT_MS = 2500;

type CheckResult = 'ok' | string;

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function checkDb(): Promise<CheckResult> {
  try {
    const { prisma } = await import('@shared/lib/prisma');
    await withTimeout(prisma.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS, 'db');
    return 'ok';
  } catch (err) {
    return err instanceof Error ? err.message : 'db check failed';
  }
}

async function checkRedis(): Promise<CheckResult> {
  try {
    const { getRedisConnection } = await import('@shared/queues');
    const redis = getRedisConnection();
    const reply = await withTimeout(redis.ping(), CHECK_TIMEOUT_MS, 'redis');
    return reply === 'PONG' ? 'ok' : `unexpected ping reply: ${reply}`;
  } catch (err) {
    return err instanceof Error ? err.message : 'redis check failed';
  }
}

async function checkS3(): Promise<CheckResult> {
  try {
    const [{ S3Client, HeadBucketCommand }, { S3_BUCKET, S3_REGION }] = await Promise.all([
      import('@aws-sdk/client-s3'),
      import('@shared/lib/storage/storage-provider'),
    ]);
    // On R2, S3_REGION is 'auto' and S3_ENDPOINT points at the R2 API host. The S3Client
    // config below is a no-op on AWS (undefined endpoint) and picks up the R2 endpoint
    // when set — so this same probe works both before and after the storage migration.
    const client = new S3Client({
      region: S3_REGION,
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    });
    await withTimeout(
      client.send(new HeadBucketCommand({ Bucket: S3_BUCKET })),
      CHECK_TIMEOUT_MS,
      's3'
    );
    return 'ok';
  } catch (err) {
    return err instanceof Error ? err.message : 's3 check failed';
  }
}

/**
 * Resolve a version identifier for this deploy.
 *
 * Priority: explicit env override -> Vercel-injected git SHA -> generic env sha ->
 * Sentry release string -> 'unknown'. Emitted on every /api/health response so uptime
 * probes + curl can confirm which build is live in seconds without hitting an admin
 * route or checking git.
 */
function getVersion(): string {
  return (
    process.env.NEXT_PUBLIC_APP_VERSION ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_SHA ||
    process.env.SENTRY_RELEASE ||
    'unknown'
  );
}

export async function GET() {
  const [db, redis, s3] = await Promise.all([checkDb(), checkRedis(), checkS3()]);
  const ok = db === 'ok' && redis === 'ok' && s3 === 'ok';
  const body = {
    status: ok ? 'ok' : 'degraded',
    db,
    redis,
    // Field names match the migration doc's spec (`db`, `redis`, `storage`). `s3` is
    // retained as an alias for the pre-migration response shape so existing Better Uptime
    // dashboards, integration tests, and ops runbooks don't break during the R2 cutover.
    storage: s3,
    s3,
    version: getVersion(),
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: ok ? 200 : 503 });
}
