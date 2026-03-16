import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow reading local CEDICT file in API routes
  serverExternalPackages: [],
  transpilePackages: ['react-force-graph-2d', 'force-graph', 'd3-force', 'three'],
};

export default nextConfig;
