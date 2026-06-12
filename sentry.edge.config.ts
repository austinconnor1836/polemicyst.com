// This file configures the initialization of Sentry for edge runtimes (e.g. middleware, edge routes).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

// Sentry.init is a no-op when DSN is unset, so no extra guard required.
Sentry.init({
  dsn,
  tracesSampleRate: 0.1,
  debug: false,
  environment: process.env.NODE_ENV,
});
