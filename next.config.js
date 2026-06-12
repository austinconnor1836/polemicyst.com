const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverActions: {
      bodySizeLimit: '2000mb',
    },
  },
};

// @sentry/nextjs v10 takes a single options object as the second arg.
// When SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN is unset, runtime Sentry.init is a no-op.
// When SENTRY_AUTH_TOKEN is unset, we skip source-map upload so local/dev builds never fail.
const sentryBuildOptions = {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  webpack: {
    treeshake: {
      // Tree-shake Sentry SDK logger calls to reduce bundle size.
      removeDebugLogging: true,
    },
  },
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
};

module.exports = withSentryConfig(nextConfig, sentryBuildOptions);
