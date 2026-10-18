import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Standalone output: a self-contained Node server for Railway/containers.
  // Explicitly NOT 'export' — these pages fetch at runtime, not build time.
  output: 'standalone',
};

export default nextConfig;
