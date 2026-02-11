module.exports = {
  middleware: true,
  matcher: ['/protected-path/:path*'], // ✅ Update to match your secured routes
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '2000mb',
    },
  },
};
