/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOTE:
  // - `output: 'standalone'` is required for Docker/production.
  // - In development, keeping standalone output can lead to confusing `.next` artifact mismatches
  //   (e.g., server chunk resolution issues) especially if switching between dev/build modes.
  // So we enable it only for production builds.
  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,
  // Keep dev/build outputs separate to avoid `.next` artifact mismatches (blank screen / webpack-runtime errors)
  // when running `next build` while `next dev` is running.
  // - dev: NEXT_DIST_DIR=.next-dev
  // - build/start: (default) .next
  distDir: process.env.NEXT_DIST_DIR || '.next',
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: process.env.NEXT_PUBLIC_API_URL
          ? `${process.env.NEXT_PUBLIC_API_URL}/api/:path*`
          : 'http://localhost:8000/api/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
