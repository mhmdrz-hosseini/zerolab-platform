import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // DB access must stay lazy: nothing here runs queries at build time.
};

export default nextConfig;
