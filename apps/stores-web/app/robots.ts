import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo/metadata";

const privatePaths = ["/api/", "/admin/", "/preview/", "/directus/"];

// Public product/store imagery is served from /api/assets/*; without this
// explicit allow the blanket /api/ disallow would hide it from image crawlers.
// This does NOT open the rest of /api/ — the more specific rule wins.
const publicAssetPaths = ["/api/assets/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: ["/", ...publicAssetPaths], disallow: privatePaths },
      { userAgent: "OAI-SearchBot", allow: ["/", ...publicAssetPaths], disallow: privatePaths },
    ],
    sitemap: new URL("/sitemap.xml", siteUrl).href,
    host: siteUrl.origin,
  };
}
