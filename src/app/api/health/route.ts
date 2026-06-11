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
    const client = new S3Client({ region: S3_REGION });
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

export async function GET() {
  const [db, redis, s3] = await Promise.all([checkDb(), checkRedis(), checkS3()]);
  const ok = db === 'ok' && redis === 'ok' && s3 === 'ok';
  const body = {
    status: ok ? 'ok' : 'degraded',
    db,
    redis,
    s3,
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: ok ? 200 : 503 });
}
