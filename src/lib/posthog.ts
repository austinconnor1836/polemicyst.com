/**
 * Server-side PostHog singleton (W013 — investor-readiness analytics).
 *
 * Returns null when POSTHOG_API_KEY is unset so dev/test environments never
 * touch PostHog. Call-sites MUST use `posthog?.capture(...)` and treat the
 * return value as optional.
 *
 * For serverless route handlers, call `await flushServerPostHog()` at the end
 * of the request (within reason — don't block the response on a slow flush).
 */
import { PostHog } from 'posthog-node';

type PostHogClient = PostHog;

declare global {
  // eslint-disable-next-line no-var
  var __clipfirePostHogServer: PostHogClient | null | undefined;
}

const DEFAULT_HOST = 'https://us.i.posthog.com';

function buildClient(): PostHogClient | null {
  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) return null;

  const host = process.env.POSTHOG_HOST || process.env.NEXT_PUBLIC_POSTHOG_HOST || DEFAULT_HOST;

  // Keep the in-memory buffer small so serverless invocations flush quickly.
  return new PostHog(apiKey, {
    host,
    flushAt: 1,
    flushInterval: 0,
  });
}

/**
 * Returns the shared PostHog client, or `null` when POSTHOG_API_KEY is unset.
 * Cached on `globalThis` so HMR / repeated invocations reuse the same client.
 */
export function getServerPostHog(): PostHogClient | null {
  if (globalThis.__clipfirePostHogServer === undefined) {
    globalThis.__clipfirePostHogServer = buildClient();
  }
  return globalThis.__clipfirePostHogServer ?? null;
}

/**
 * Flush any buffered events. Safe to call when PostHog isn't configured
 * (no-op). Swallows errors so it can be awaited in a route handler without
 * risking a 500.
 */
export async function flushServerPostHog(): Promise<void> {
  const client = globalThis.__clipfirePostHogServer;
  if (!client) return;
  try {
    await client.flush();
  } catch {
    // Non-fatal — analytics must never break the user-facing pipeline.
  }
}
