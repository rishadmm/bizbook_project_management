import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["better-sqlite3", "@react-pdf/renderer"],
  outputFileTracingIncludes: { "/invoices/[id]/pdf": ["./src/assets/fonts/**"], "/p/[slug]/invoices/[id]/pdf": ["./src/assets/fonts/**"] },
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
};

export default nextConfig;
