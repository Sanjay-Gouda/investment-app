import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Standalone output: a self-contained Node server for Railway/containers.
  // Explicitly NOT 'export' — these pages fetch at runtime, not build time.
  output: 'standalone',
  // Don't let a lint/type discrepancy in the deploy environment fail the build.
  // Types are still gated locally/CI via `npm run typecheck`.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
