import type { NextConfig } from "next";

function parseDirectusImagePattern() {
  const directusUrl = process.env.DIRECTUS_URL;
  if (!directusUrl) return [];
  try {
    const url = new URL(directusUrl);
    return [
      {
        protocol: url.protocol.replace(":", "") as "http" | "https",
        hostname: url.hostname,
        port: url.port || undefined,
        pathname: "/assets/**",
      },
    ];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: { root: process.cwd() },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: parseDirectusImagePattern(),
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      // Non-fingerprinted public images ship with each deploy and change only
      // with it. The default for public files is max-age=0, which forces a
      // revalidation round-trip per asset on every repeat visit; serve them
      // from cache for a day and let stale-while-revalidate refresh them in
      // the background afterwards. Listed after the catch-all so this
      // Cache-Control value wins for these paths.
      {
        source: "/brands/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=31536000" }],
      },
      {
        source: "/actual/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=31536000" }],
      },
    ];
  },
};

export default nextConfig;
