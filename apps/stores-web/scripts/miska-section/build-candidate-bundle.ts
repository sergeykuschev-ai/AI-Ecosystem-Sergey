/**
 * Builds a candidate «Миска» static bundle for the next release and verifies
 * it end to end. Replaces one-off bundle edits with a reproducible build:
 * the same inputs always produce the same tree (and the same tree hash).
 *
 *   tsx scripts/miska-section/build-candidate-bundle.ts --bundle <dir> --out <dir>
 *
 * Safety:
 * - the source bundle is never written to (only read);
 * - --out must not exist yet — the script refuses to overwrite anything;
 * - after building, the script proves that the ONLY differences from the
 *   source are the 20 published product pages' <title>/og:title and the
 *   agreed robots.txt `Allow: /api/assets/` addition.
 *
 * Verification covers: exact file-level diff, per-page byte comparison
 * outside the title fields, manifest-conformant titles, robots invariants
 * (assets allowed, rest of /api/ still disallowed, both sitemaps intact),
 * presence and validity of every referenced product image, and pilot
 * sitemap completeness against the publication manifest.
 */

import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  assertMiskaCatalogManifestIntegrity,
  getPublishedMiskaCatalogProducts,
} from "@/lib/miska/published-catalog";
import { getMiskaSectionSitemapPaths } from "./build-pilot-sitemap";
import { allowApiAssetsInRobots, API_ASSETS_ALLOW_LINE, assertCandidateRobots } from "./candidate-robots";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function* walk(dir: string, base = dir): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full, base);
    else yield path.relative(base, full);
  }
}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Deterministic tree hash: hash of the sorted (path, content-hash) chain. */
export function treeHash(dir: string): string {
  const chain = [...walk(dir)].map((rel) => `${rel}\0${sha256(readFileSync(path.join(dir, rel)))}`);
  return sha256(chain.join("\n"));
}

function stripTitleFields(html: string): string {
  return html
    .replace(/<title>[\s\S]*?<\/title>/, "<title/>")
    .replace(/<meta property="og:title" content="[^"]*"/, "<meta og:title/>");
}

interface BuildReport {
  builtAt: string;
  sourceDir: string;
  sourceTreeSha256: string;
  candidateDir: string;
  candidateTreeSha256: string;
  changedFiles: string[];
  titleChanges: Array<{ slug: string; before: string; after: string }>;
}

function main(): void {
  const sourceDir = path.resolve(argument("--bundle"));
  const outDir = path.resolve(argument("--out"));

  // --- guards: never overwrite source or destination ---
  if (sourceDir === outDir) throw new Error("--bundle and --out must be different directories");
  if (!existsSync(sourceDir)) throw new Error(`source bundle not found: ${sourceDir}`);
  if (!existsSync(path.join(sourceDir, "miska")) || !existsSync(path.join(sourceDir, "robots.txt"))) {
    throw new Error(`${sourceDir} does not look like a «Миска» section bundle (missing miska/ or robots.txt)`);
  }
  if (existsSync(outDir)) throw new Error(`refusing to overwrite existing output directory: ${outDir}`);
  if (outDir.startsWith(sourceDir + path.sep) || sourceDir.startsWith(outDir + path.sep)) {
    throw new Error("--bundle and --out must not contain each other");
  }

  assertMiskaCatalogManifestIntegrity();
  const sourceTreeSha256 = treeHash(sourceDir);

  cpSync(sourceDir, outDir, { recursive: true });

  // --- 1. product titles ---
  const titleChanges: BuildReport["titleChanges"] = [];
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
    if (before !== product.shortTitle && updated === html) throw new Error(`${product.slug}: rewrite made no change`);
    writeFileSync(file, updated);
    if (before !== product.shortTitle) titleChanges.push({ slug: product.slug, before, after: product.shortTitle });
  }

  // --- 2. robots.txt: narrow /api/assets/ allow ---
  const robotsFile = path.join(outDir, "robots.txt");
  const robotsBefore = readFileSync(robotsFile, "utf8");
  const robotsAfter = allowApiAssetsInRobots(robotsBefore);
  writeFileSync(robotsFile, robotsAfter);

  // === verification ===
  const problems: string[] = [];
  const allowedChanged = new Set([
    "robots.txt",
    ...getPublishedMiskaCatalogProducts().map((p) => path.join("miska", "tovary", p.slug, "index.html")),
  ]);
  const changedFiles: string[] = [];
  const sourceFiles = new Set(walk(sourceDir));
  const candidateFiles = new Set(walk(outDir));
  for (const rel of candidateFiles) {
    if (!sourceFiles.has(rel)) problems.push(`unexpected new file: ${rel}`);
  }
  for (const rel of sourceFiles) {
    if (!candidateFiles.has(rel)) problems.push(`missing file in candidate: ${rel}`);
  }
  for (const rel of sourceFiles) {
    if (!candidateFiles.has(rel)) continue;
    const a = readFileSync(path.join(sourceDir, rel));
    const b = readFileSync(path.join(outDir, rel));
    if (a.equals(b)) continue;
    changedFiles.push(rel);
    if (!allowedChanged.has(rel)) problems.push(`file changed but is not in the allowed set: ${rel}`);
    if (rel.endsWith("index.html")) {
      if (stripTitleFields(a.toString("utf8")) !== stripTitleFields(b.toString("utf8"))) {
        problems.push(`${rel}: content outside <title>/og:title was modified`);
      }
    }
  }

  // robots invariants: agreed allow line present, blanket /api/ disallow and
  // both sitemap directives intact, and the ONLY robots change is the allow line
  try {
    assertCandidateRobots(robotsAfter);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  const robotsStripped = robotsAfter
    .split("\n")
    .filter((line) => line.trim() !== API_ASSETS_ALLOW_LINE)
    .join("\n");
  if (robotsStripped !== robotsBefore) {
    problems.push("robots.txt: changes other than the `Allow: /api/assets/` insertion detected");
  }

  // titles conform to the manifest
  for (const change of titleChanges) {
    if (change.after.length > 70) problems.push(`${change.slug}: title still ${change.after.length} chars (> 70)`);
  }

  // images referenced by the bundle exist, are non-empty and look like their type
  let imagesChecked = 0;
  for (const rel of candidateFiles) {
    if (!rel.endsWith("index.html")) continue;
    const html = readFileSync(path.join(outDir, rel), "utf8");
    const refs = new Set<string>();
    for (const match of html.matchAll(/<img[^>]*src="([^"]+)"/g)) refs.add(match[1]);
    for (const match of html.matchAll(/"image"\s*:\s*"(https:\/\/amurskmarket\.ru)?([^"]+)"/g)) refs.add(match[2]);
    for (const ref of refs) {
      if (!ref.startsWith("/miska/")) continue;
      const imgPath = path.join(outDir, ref);
      if (!existsSync(imgPath)) {
        problems.push(`${rel}: referenced image is missing from the bundle: ${ref}`);
        continue;
      }
      const bytes = readFileSync(imgPath);
      if (bytes.length === 0) {
        problems.push(`${rel}: referenced image is empty: ${ref}`);
        continue;
      }
      if (ref.endsWith(".webp") && bytes.subarray(8, 12).toString("ascii") !== "WEBP") {
        problems.push(`${rel}: ${ref} is not a valid WebP (bad magic)`);
        continue;
      }
      imagesChecked += 1;
    }
  }

  // pilot sitemap completeness against the manifest
  const sitemapXml = readFileSync(path.join(outDir, "sitemap-miska-pilot.xml"), "utf8");
  const sitemapUrls = new Set([...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname));
  for (const p of getMiskaSectionSitemapPaths()) {
    if (!sitemapUrls.has(p)) problems.push(`pilot sitemap is missing manifest path: ${p}`);
  }

  if (problems.length > 0) {
    console.error("CANDIDATE VERIFICATION FAILED:");
    for (const problem of problems) console.error(`- ${problem}`);
    process.exitCode = 1;
    return;
  }

  const report: BuildReport = {
    builtAt: new Date().toISOString(),
    sourceDir,
    sourceTreeSha256,
    candidateDir: outDir,
    candidateTreeSha256: treeHash(outDir),
    changedFiles: changedFiles.sort(),
    titleChanges,
  };
  // The report lives next to the bundle, not inside it: the candidate tree
  // stays exactly the publishable file set (and its hash matches the report).
  const reportPath = `${outDir}.candidate-report.json`;
  if (existsSync(reportPath)) throw new Error(`refusing to overwrite existing report: ${reportPath}`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");

  console.log(JSON.stringify({
    verdict: "OK",
    changedFiles: report.changedFiles.length,
    titleChanges: titleChanges.length,
    imagesChecked,
    sourceTreeSha256,
    candidateTreeSha256: report.candidateTreeSha256,
    reportPath,
  }, null, 2));
}

main();

export {};
