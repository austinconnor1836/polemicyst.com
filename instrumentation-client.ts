// Client-side Sentry initialization.
// https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client
// Sentry SDK v10+ recommends this file in place of the legacy `sentry.client.config.ts`.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

// Sentry.init is a no-op when DSN is unset, so no extra guard required.
Sentry.init({
  dsn,
  tracesSampleRate: 0.1,
  debug: false,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
});

// Required by @sentry/nextjs v10+ to instrument client-side navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
