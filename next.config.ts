import type { NextConfig } from 'next';
import StylelintPlugin from 'stylelint-webpack-plugin';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: [process.env['NEXT_MAIN_HOST']!],
  outputFileTracingRoot: __dirname,

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `frame-ancestors 'self' ${process.env['NEXT_IFRAME_HOST_PRODUCT']!} ${process.env['NEXT_IFRAME_HOST_PEOPLE']!}`,
          },
        ],
      },
    ];
  },

  webpack(config) {
    config.plugins.push(new StylelintPlugin());

    return config;
  },
};

export default nextConfig;
