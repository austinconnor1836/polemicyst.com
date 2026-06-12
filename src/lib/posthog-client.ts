/**
 * Client-side PostHog wrapper (W013).
 *
 * Hard requirements:
 *   1. NEVER load posthog-js until the user has accepted cookies. The cookie
 *      banner (PR #268 / W006) writes `clipfire-cookie-consent=accepted` to
 *      localStorage when the user clicks "Accept".
 *   2. NEVER initialize when NEXT_PUBLIC_POSTHOG_KEY is unset — the SDK
 *      becomes a complete no-op in dev/test.
 *
 * Both gates must be true before any network call is made.
 */

const CONSENT_KEY = 'clipfire-cookie-consent';

type PostHogModule = typeof import('posthog-js');
type PostHogInstance = PostHogModule['default'];

let initPromise: Promise<PostHogInstance | null> | null = null;
let cachedClient: PostHogInstance | null = null;

function hasCookieConsent(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(CONSENT_KEY) === 'accepted';
  } catch {
    return false;
  }
}

function getApiKey(): string | undefined {
  return process.env.NEXT_PUBLIC_POSTHOG_KEY;
}

function getHost(): string {
  return process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
}

/**
 * Initialize posthog-js if the user has accepted cookies AND the env key is
 * set. Returns the client instance, or null when either gate fails.
 *
 * Safe to call repeatedly — only initializes once per page lifetime.
 */
export async function initClientPostHog(): Promise<PostHogInstance | null> {
  if (typeof window === 'undefined') return null;
  if (cachedClient) return cachedClient;
  if (!hasCookieConsent()) return null;
  if (!getApiKey()) return null;

  if (!initPromise) {
    initPromise = import('posthog-js')
      .then((mod) => {
        const ph = mod.default;
        ph.init(getApiKey()!, {
          api_host: getHost(),
          // We rely on the cookie banner to gate consent. Once consent is
          // given, persistence via localStorage is acceptable.
          persistence: 'localStorage+cookie',
          capture_pageview: true,
          capture_pageleave: true,
          // Investor-readiness scope: explicit conversion events only;
          // no session recording or autocapture in this wave.
          autocapture: false,
          disable_session_recording: true,
        });
        cachedClient = ph;
        return ph;
      })
      .catch(() => null);
  }
  return initPromise;
}

/**
 * Tie the active session to the authenticated user id. Idempotent — calling
 * this repeatedly with the same id is cheap.
 */
export async function identifyClientPostHog(userId: string): Promise<void> {
  const client = await initClientPostHog();
  if (!client || !userId) return;
  try {
    client.identify(userId);
  } catch {
    // Non-fatal.
  }
}

/**
 * Fire a client-side event. No-op when posthog isn't initialized (env unset
 * or consent missing).
 */
export async function captureClientEvent(
  event: string,
  properties?: Record<string, unknown>
): Promise<void> {
  const client = await initClientPostHog();
  if (!client) return;
  try {
    client.capture(event, properties);
  } catch {
    // Non-fatal.
  }
}

/** Clear PostHog state on sign-out so the next user starts clean. */
export async function resetClientPostHog(): Promise<void> {
  if (!cachedClient) return;
  try {
    cachedClient.reset();
  } catch {
    // Non-fatal.
  }
}
