import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The FalkorDB client and the MCP SDK run on the server only.
  serverExternalPackages: ['falkordb', '@modelcontextprotocol/sdk'],
  poweredByHeader: false,
  devIndicators: false,
  reactStrictMode: true,
  output: process.env.DOMINO_STANDALONE === 'true' ? 'standalone' : undefined,
  // The share image reads its fonts from disk at request time.
  outputFileTracingIncludes: { '/opengraph-image': ['./src/assets/fonts/**'] },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
};

export default nextConfig;
