// Next.js instrumentation entry point.
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
// Sentry SDK v10+ requires server-side Sentry.init to run from this hook.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Forward Next.js request errors to Sentry. Imported lazily so the edge runtime
// only pulls in @sentry/nextjs when it actually invokes this hook.
export async function onRequestError(
  ...args: Parameters<typeof import('@sentry/nextjs').captureRequestError>
) {
  const { captureRequestError } = await import('@sentry/nextjs');
  captureRequestError(...args);
}
