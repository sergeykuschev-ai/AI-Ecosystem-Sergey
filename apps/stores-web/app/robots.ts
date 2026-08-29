import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo/metadata";

const privatePaths = ["/api/", "/admin/", "/preview/", "/directus/", "/_next/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: privatePaths },
      { userAgent: "OAI-SearchBot", allow: "/", disallow: privatePaths },
    ],
    sitemap: new URL("/sitemap.xml", siteUrl).href,
    host: siteUrl.origin,
  };
}
