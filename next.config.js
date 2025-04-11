module.exports = {
  middleware: true,
  matcher: ["/protected-path/:path*"], // ✅ Update to match your secured routes
  output: "standalone",
  experimental: {
    serverActions: {
      bodySizeLimit: '2000mb',
    },
  },
  async rewrites() {
    return [
      {
        source: '/api/backend/:path*',
        destination: 'http://host.docker.internal:3001/:path*' // backend runs in Docker on port 3001
      },
    ];
  },
};