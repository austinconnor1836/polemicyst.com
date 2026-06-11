/**
 * Rate limiting helper.
 *
 * Uses `@upstash/ratelimit` + `@upstash/redis` when `UPSTASH_REDIS_REST_URL`
 * + `UPSTASH_REDIS_REST_TOKEN` are set (preferred for production — works
 * across serverless instances).
 *
 * Otherwise falls back to a per-process in-memory Map so dev/local works
 * without any external dependency.
 *
 * NOTE: The in-memory fallback does NOT span instances. In multi-instance
 * deployments (ECS, Vercel), set the Upstash env vars to get cross-instance
 * coordination.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export interface LimiterOpts {
  /** Max requests allowed per window. */
  tokens: number;
  /** Window size, e.g. '60 s', '1 m'. */
  window: string;
  /** Key prefix for namespacing in shared storage. */
  prefix: string;
}

export interface LimiterResult {
  success: boolean;
  /** Seconds until the window resets (best-effort). */
  retryAfter: number;
  limit: number;
  remaining: number;
}

export interface Limiter {
  check(key: string): Promise<LimiterResult>;
  readonly mode: 'upstash' | 'memory';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse "30 s", "1 m", "2 h" into milliseconds. */
function parseWindowMs(window: string): number {
  const m = window.trim().match(/^(\d+)\s*([smhd])$/i);
  if (!m) {
    throw new Error(`Invalid rate-limit window: ${window}`);
  }
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return n * mult;
}

// ---------------------------------------------------------------------------
// In-memory fallback
// ---------------------------------------------------------------------------

interface BucketEntry {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, BucketEntry>();

function memoryCheck(prefix: string, key: string, tokens: number, windowMs: number): LimiterResult {
  const fullKey = `${prefix}:${key}`;
  const now = Date.now();
  const entry = memoryStore.get(fullKey);

  if (!entry || entry.resetAt <= now) {
    memoryStore.set(fullKey, { count: 1, resetAt: now + windowMs });
    return { success: true, retryAfter: 0, limit: tokens, remaining: tokens - 1 };
  }

  if (entry.count >= tokens) {
    return {
      success: false,
      retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      limit: tokens,
      remaining: 0,
    };
  }

  entry.count += 1;
  return {
    success: true,
    retryAfter: 0,
    limit: tokens,
    remaining: Math.max(0, tokens - entry.count),
  };
}

// Light periodic cleanup so the Map doesn't grow unbounded under load.
// Only schedule once per process. Not critical — entries are short-lived.
let cleanupScheduled = false;
function scheduleMemoryCleanup() {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  // Don't keep the Node process alive just for cleanup.
  const t = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of memoryStore) {
      if (v.resetAt <= now) memoryStore.delete(k);
    }
  }, 60_000);
  if (typeof t.unref === 'function') t.unref();
}

// ---------------------------------------------------------------------------
// Upstash factory (lazy import so unset envs incur zero cost)
// ---------------------------------------------------------------------------

let upstashRatelimitCtor: any = null;
let upstashRedis: any = null;

async function getUpstashCtor(): Promise<{ Ratelimit: any; redis: any } | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  if (!upstashRatelimitCtor) {
    const [{ Ratelimit }, { Redis }] = await Promise.all([
      import('@upstash/ratelimit'),
      import('@upstash/redis'),
    ]);
    upstashRatelimitCtor = Ratelimit;
    upstashRedis = new Redis({ url, token });
  }
  return { Ratelimit: upstashRatelimitCtor, redis: upstashRedis };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createLimiter(opts: LimiterOpts): Limiter {
  const windowMs = parseWindowMs(opts.window);
  const upstashAvailable =
    !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!upstashAvailable) {
    scheduleMemoryCleanup();
    return {
      mode: 'memory',
      async check(key: string) {
        return memoryCheck(opts.prefix, key, opts.tokens, windowMs);
      },
    };
  }

  // Lazy-initialised Upstash limiter. Cached on first call.
  let limiter: any = null;
  return {
    mode: 'upstash',
    async check(key: string) {
      if (!limiter) {
        const upstash = await getUpstashCtor();
        if (!upstash) {
          // Env vanished mid-flight — degrade to memory.
          return memoryCheck(opts.prefix, key, opts.tokens, windowMs);
        }
        limiter = new upstash.Ratelimit({
          redis: upstash.redis,
          limiter: upstash.Ratelimit.slidingWindow(opts.tokens, opts.window),
          prefix: opts.prefix,
          analytics: false,
        });
      }
      const res = await limiter.limit(key);
      const retryAfter = res.success ? 0 : Math.max(1, Math.ceil((res.reset - Date.now()) / 1000));
      return {
        success: res.success,
        retryAfter,
        limit: res.limit,
        remaining: res.remaining,
      };
    },
  };
}

/**
 * Derive a client IP from common forwarded headers, falling back to a stable
 * literal so we don't accidentally lump every unidentifiable request into one
 * shared bucket in dev.
 */
export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

/**
 * Apply a limiter for a given key. Returns `null` if the request is under
 * the limit, or a 429 `NextResponse` with `Retry-After` if it's over.
 */
export async function applyLimit(
  _req: NextRequest | Request,
  key: string,
  limiter: Limiter
): Promise<NextResponse | null> {
  const result = await limiter.check(key);
  if (result.success) return null;

  return NextResponse.json(
    { error: 'Too many requests', retryAfter: result.retryAfter },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfter),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': '0',
      },
    }
  );
}
