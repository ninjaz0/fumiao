import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  // Keep legacy redirect query bytes (%20, repeated keys) intact in Proxy.
  skipProxyUrlNormalize: true,
  distDir: process.env.FUMIAO_NEXT_DIST || ".next",
  typescript: {
    tsconfigPath: process.env.FUMIAO_NEXT_TSCONFIG || "tsconfig.json",
  },
};
export default config;
