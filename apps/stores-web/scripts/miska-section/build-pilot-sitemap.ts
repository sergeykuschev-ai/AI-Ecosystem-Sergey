/**
 * Builds sitemap-miska-pilot.xml for the static «Миска» section bundle.
 *
 * The static bundle (katalog, categories, product cards and the SEO section
 * copies under /miska/) is published to Caddy out-of-band; this script is the
 * single generator for its sitemap so the sitemap always derives from the
 * same publication manifest as the pages (lib/miska/published-catalog.ts).
 *
 * Usage:
 *   tsx scripts/miska-section/build-pilot-sitemap.ts            # print to stdout
 *   tsx scripts/miska-section/build-pilot-sitemap.ts --out <file>
 *
 * Only canonical absolute HTTPS URLs with a trailing slash are emitted.
 * No <lastmod> is written: the manifest has no trustworthy per-page
 * modification dates, and request time must not masquerade as one.
 */

import { writeFileSync } from "node:fs";
import { MISKA_SEO_CATEGORY_PATHS } from "@/lib/miska/seo-categories";
import {
  assertMiskaCatalogManifestIntegrity,
  getPublishedMiskaCatalogPaths,
} from "@/lib/miska/published-catalog";
import { siteUrl } from "@/lib/seo/metadata";

/** Every page the static «Миска» bundle serves and search engines may index. */
export function getMiskaSectionSitemapPaths(): string[] {
  assertMiskaCatalogManifestIntegrity();
  return [
    ...new Set(["/miska/", ...MISKA_SEO_CATEGORY_PATHS, ...getPublishedMiskaCatalogPaths()]),
  ];
}

export function renderMiskaSectionSitemap(paths: string[] = getMiskaSectionSitemapPaths()): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const path of paths) {
    if (!path.endsWith("/")) throw new Error(`Non-canonical path without trailing slash: ${path}`);
    lines.push(`  <url><loc>${new URL(path, siteUrl).href}</loc></url>`);
  }
  lines.push("</urlset>", "");
  return lines.join("\n");
}

function main(): void {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const xml = renderMiskaSectionSitemap();
  if (outIndex >= 0) {
    const target = args[outIndex + 1];
    if (!target) throw new Error("--out requires a file path");
    writeFileSync(target, xml);
    console.log(`Wrote ${target} (${getMiskaSectionSitemapPaths().length} URLs)`);
    return;
  }
  process.stdout.write(xml);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
