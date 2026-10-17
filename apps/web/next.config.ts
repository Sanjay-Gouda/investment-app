import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The shared package ships TypeScript source; let Next transpile it.
  transpilePackages: ['@corgi/shared'],
};

export default nextConfig;
