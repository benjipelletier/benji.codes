import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow reading local CEDICT file in API routes
  serverExternalPackages: [],
};

export default nextConfig;
