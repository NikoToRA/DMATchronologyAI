/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOTE:
  // - `output: 'standalone'` is required for Docker/production.
  // - In development, keeping standalone output can lead to confusing `.next` artifact mismatches
  //   (e.g., server chunk resolution issues) especially if switching between dev/build modes.
  // So we enable it only for production builds.
  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,
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
