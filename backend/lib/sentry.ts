/**
 * Sentry initialization for the Express backend and BullMQ workers.
 *
 * The Next.js side lives at `../../sentry.server.config.ts` + `instrumentation.ts` and is
 * wired via `@sentry/nextjs`. Anything running OUTSIDE the Next.js runtime — the Express
 * backend, the BullMQ workers under `workers/`, standalone scripts — imports this file.
 *
 * DESIGN NOTES
 * - Sentry.init is a no-op when SENTRY_DSN is unset. No env-guard boilerplate needed at
 *   the call site. Same convention as `sentry.server.config.ts`.
 * - We deliberately delay-load `@sentry/node` so a build without SENTRY_DSN (dev laptops,
 *   CI unit tests) does not require the module. The compute-plane agent should add
 *   `@sentry/node` to the root `package.json` when it wires this into the Express bootstrap
 *   or worker index — currently only `@sentry/nextjs` is in deps, and its transitive
 *   `@sentry/node` covers workers that import from `@sentry/nextjs` directly (already the
 *   case in `workers/clip-metadata-worker/index.ts`).
 * - `SENTRY_RELEASE` is set by CI to the git SHA of the deploy so Sentry can group
 *   regressions across releases.
 * - Rate-limiter / DB helpers must call `Sentry.captureException` on failure but must NOT
 *   throw further — observability failures cannot take the app down.
 */

let initialized = false;

export interface InitSentryOptions {
  /** Extra tags applied to every event. */
  tags?: Record<string, string>;
  /** Override the sample rate for performance spans. Defaults to 0.1. */
  tracesSampleRate?: number;
  /** Override the sample rate for profiling. Defaults to 0 (off; opt-in in Fly). */
  profilesSampleRate?: number;
}

/**
 * Idempotent init. Call this ONCE per process, at the very top of the entry file.
 *
 * Express:
 * ```ts
 * import { initSentry, sentryErrorHandler } from './lib/sentry';
 * initSentry({ tags: { service: 'backend' } });
 * // ... routes ...
 * app.use(sentryErrorHandler);
 * ```
 *
 * BullMQ workers already call `Sentry.init` directly from `@sentry/nextjs` (see
 * `workers/clip-metadata-worker/index.ts:10`). This helper is a superset of that call —
 * new worker files should use this helper for consistency, but the existing worker line
 * does not need to change.
 */
export async function initSentry(opts: InitSentryOptions = {}): Promise<void> {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  // `@sentry/nextjs` re-exports the `@sentry/node` surface for `NEXT_RUNTIME=nodejs`
  // callers, which covers the Express backend + all TS workers. Preferring it over a
  // separate `@sentry/node` dep keeps the dependency graph flat.
  const Sentry = await import('@sentry/nextjs');

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    tracesSampleRate: opts.tracesSampleRate ?? 0.1,
    profilesSampleRate: opts.profilesSampleRate ?? 0,
    // Backend + workers run as long-lived processes; auto-flush on shutdown handled by
    // the SDK when SIGTERM lands. Nothing to do here.
  });

  if (opts.tags) {
    Sentry.setTags(opts.tags);
  }
}

/**
 * Fire-and-forget capture. Never throws.
 *
 * Prefer this over calling `Sentry.captureException` directly from cross-cutting helpers
 * (rate limiters, health checks, log shippers) — this variant swallows any error thrown
 * by Sentry itself, which prevents an observability outage from bringing down the app.
 */
export async function captureExceptionSafe(
  err: unknown,
  context?: Record<string, unknown>
): Promise<void> {
  try {
    if (!initialized) return;
    const Sentry = await import('@sentry/nextjs');
    Sentry.captureException(err, context ? { extra: context } : undefined);
  } catch {
    // Deliberately empty — Sentry itself failed, and we're not going to fail because of it.
  }
}

/**
 * Express error-handling middleware. Mount LAST, after all routes:
 * ```
 * app.use(sentryErrorHandler);
 * ```
 * Downstream `next(err)` calls end up here. Non-Express callers can ignore this export.
 */
// Types intentionally loose: Express is not a dep of the base repo (the current backend/
// dir is a stub). When the compute-plane agent lands Express, tighten to `Request` /
// `Response` / `NextFunction`. `unknown` keeps type-safety without pinning us to Express.
export function sentryErrorHandler(
  err: unknown,
  req: { originalUrl?: string; method?: string } | undefined,
  res:
    | {
        headersSent?: boolean;
        status?: (code: number) => { json?: (payload: unknown) => void };
      }
    | undefined,
  next: (err: unknown) => void
) {
  captureExceptionSafe(err, { path: req?.originalUrl, method: req?.method });
  if (res?.headersSent) return next(err);
  const status =
    err &&
    typeof err === 'object' &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number'
      ? (err as { status: number }).status
      : 500;
  res?.status?.(status)?.json?.({ error: 'internal_error' });
}
