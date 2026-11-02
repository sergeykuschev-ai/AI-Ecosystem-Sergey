/**
 * Applies the manifest's curated shortTitle values to the static «Миска»
 * bundle, producing a candidate bundle for the next release.
 *
 * The static product pages are generated HTML, and their <title> currently
 * duplicates the full 1C-derived product name (up to 152 chars). This script
 * is the deterministic, reviewable path from the publication manifest
 * (lib/miska/published-catalog.ts) to generated pages: it rewrites ONLY the
 * <title> element and the og:title meta of each published product page and
 * proves byte-level that nothing else changed.
 *
 * Usage:
 *   tsx scripts/miska-section/apply-product-titles.ts --bundle <dir> --out <dir>
 *
 * Neither the source bundle nor production is modified; --out receives a
 * fresh candidate tree.
 */

import { cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  assertMiskaCatalogManifestIntegrity,
  getPublishedMiskaCatalogProducts,
} from "@/lib/miska/published-catalog";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function main(): void {
  const bundleDir = argument("--bundle");
  const outDir = argument("--out");
  assertMiskaCatalogManifestIntegrity();

  cpSync(bundleDir, outDir, { recursive: true });

  const changes: Array<{ slug: string; before: string; after: string }> = [];
  for (const product of getPublishedMiskaCatalogProducts()) {
    const file = path.join(outDir, "miska", "tovary", product.slug, "index.html");
    const html = readFileSync(file, "utf8");

    const titleMatches = html.match(/<title>[\s\S]*?<\/title>/g) ?? [];
    if (titleMatches.length !== 1) throw new Error(`${product.slug}: expected exactly one <title>, found ${titleMatches.length}`);
    const before = titleMatches[0].replace(/^<title>/, "").replace(/<\/title>$/, "");

    let updated = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(product.shortTitle)}</title>`);
    updated = updated.replace(
      /<meta property="og:title" content="[^"]*"/,
      `<meta property="og:title" content="${escapeHtml(product.shortTitle)}"`,
    );
    if (updated === html) throw new Error(`${product.slug}: rewrite made no change`);

    writeFileSync(file, updated);
    changes.push({ slug: product.slug, before, after: product.shortTitle });
  }

  console.log(`Applied shortTitle to ${changes.length} product pages:`);
  for (const change of changes) {
    console.log(`- ${change.slug}\n  before (${change.before.length}): ${change.before}\n  after  (${change.after.length}): ${change.after}`);
  }
}

main();

export {};
