/**
 * Reproducible lab baseline for Core Web Vitals proxies on the five priority
 * pages. Runs against a locally started production server (mock content).
 *
 * Chrome/Lighthouse cannot start under the macOS sandbox used for development
 * (ProcessSingleton socket creation is denied), so this script measures the
 * deterministic, environment-independent signals that CWV depends on:
 *   - TTFB and full response time per page (median of N warm runs);
 *   - HTML transfer size (raw and gzip wire size);
 *   - every script/css/image the page references: wire size, compression,
 *     cache headers;
 *   - markup-level CWV proxies (LCP preload hints, image srcset widths,
 *     inline script volume).
 *
 * Run a hermetic server first:
 *   CONTENT_SOURCE=mock npm run build
 *   cp -r public .next/standalone/public
 *   cp -r .next/static .next/standalone/.next/static
 *   node .next/standalone/server.js   (PORT defaults to 3000)
 *
 * Usage: node --import tsx scripts/perf/cwv-baseline.ts [baseUrl] [--json out.json]
 */

import { execFileSync } from "node:child_process";

const BASE = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const PAGES = ["/", "/amper/", "/ventil/", "/metiz-market/", "/miska/"];
const RUNS = 5;

interface AssetProbe {
  url: string;
  status: number;
  wireBytes: number;
  gzipBytes: number;
  cacheControl: string;
}

function curl(path: string, extraArgs: string[] = []): string {
  return execFileSync(
    "curl",
    ["-sS", "-o", "/dev/null", "-w", "%{http_code} %{size_download} %{time_starttransfer}", ...extraArgs, path],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
}

/** Returns [status, wireBytes, ttfbMs] for an uncompressed GET. */
function probeRaw(url: string): { status: number; bytes: number; ttfbMs: number } {
  const [status, size, ttfb] = curl(url).split(" ");
  return { status: Number(status), bytes: Number(size), ttfbMs: Number(ttfb) * 1000 };
}

/** Returns [status, gzipWireBytes] for a gzip-compressed GET. */
function probeGzip(url: string): number {
  const out = curl(url, ["--compressed", "-H", "Accept-Encoding: gzip"]);
  const [status, size] = out.split(" ");
  if (Number(status) !== 200) return 0;
  return Number(size);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function probeAsset(ref: string): AssetProbe {
  const url = ref.startsWith("http") ? ref : `${BASE}${ref}`;
  const raw = probeRaw(url);
  return {
    url: ref,
    status: raw.status,
    wireBytes: raw.bytes,
    gzipBytes: probeGzip(url),
    cacheControl:
      execFileSync("curl", ["-sSI", url], { encoding: "utf8" })
        .split("\n")
        .find((line) => line.toLowerCase().startsWith("cache-control"))
        ?.trim() ?? "(none)",
  };
}

interface PageResult {
  path: string;
  ttfbMs: number;
  totalHtmlBytes: number;
  htmlGzipBytes: number;
  imageCount: number;
  images: string[];
  preloads: string[];
  inlineScripts: number;
  jsChunks: AssetProbe[];
  otherAssets: AssetProbe[];
  jsTotalGzip: number;
  cssTotalGzip: number;
}

function analyzeHtml(html: string) {
  const assetRefs = new Set<string>();
  for (const match of html.matchAll(/(?:src|href)="(\/_next\/[^"]+\.(?:js|css))"/g)) {
    assetRefs.add(match[1].replace(/&amp;/g, "&"));
  }
  const images = Array.from(html.matchAll(/<img[^>]+src="([^"]+)"[^>]*/g)).map((m) => ({
    src: m[1],
    hasSrcset: m[0].includes("srcset="),
    hasSizes: m[0].includes("sizes="),
  }));
  const preloads = Array.from(html.matchAll(/<link[^>]+rel="preload"[^>]*>/g)).map((m) => m[0]);
  const inlineScripts = (html.match(/<script(?![^>]+src=)[^>]*>/g) ?? []).length;
  const externalScripts = Array.from(
    html.matchAll(/<script[^>]+src="(https?:\/\/[^"]+)"/g),
    (m) => m[1],
  );
  return { assetRefs, images, preloads, inlineScripts, externalScripts };
}

async function measurePage(path: string): Promise<PageResult> {
  const url = `${BASE}${path}`;
  const warm = Array.from({ length: RUNS }, () => probeRaw(url));
  const html = execFileSync("curl", ["-sS", url], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const { assetRefs, images, preloads, inlineScripts, externalScripts } = analyzeHtml(html);

  const probes = [...assetRefs, ...externalScripts].map(probeAsset);
  const jsChunks = probes.filter((p) => p.url.includes(".js"));
  const otherAssets = probes.filter((p) => !p.url.includes(".js"));

  return {
    path,
    ttfbMs: median(warm.map((w) => w.ttfbMs)),
    totalHtmlBytes: median(warm.map((w) => w.bytes)),
    htmlGzipBytes: probeGzip(url),
    imageCount: images.length,
    images: images.map((i) => `${i.src}${i.hasSrcset && i.hasSizes ? " [srcset+sizes]" : ""}`),
    preloads: preloads.map((p) => p.replace(/\s+/g, " ").slice(0, 200)),
    inlineScripts,
    jsChunks: jsChunks.sort((a, b) => b.gzipBytes - a.gzipBytes),
    otherAssets: otherAssets.sort((a, b) => b.gzipBytes - a.gzipBytes),
    jsTotalGzip: jsChunks.reduce((sum, p) => sum + p.gzipBytes, 0),
    cssTotalGzip: otherAssets.filter((p) => p.url.endsWith(".css")).reduce((sum, p) => sum + p.gzipBytes, 0),
  };
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

async function main() {
  const results: PageResult[] = [];
  for (const page of PAGES) results.push(await measurePage(page));

  const jsonFlag = process.argv.indexOf("--json");
  if (jsonFlag !== -1 && process.argv[jsonFlag + 1]) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.argv[jsonFlag + 1], JSON.stringify({ base: BASE, date: new Date().toISOString(), pages: results }, null, 2));
  }

  console.log(`Baseline against ${BASE}\n`);
  for (const r of results) {
    console.log(`=== ${r.path} ===`);
    console.log(
      `  TTFB ~${r.ttfbMs.toFixed(0)}ms | HTML ${kb(r.totalHtmlBytes)} (${kb(r.htmlGzipBytes)} gzip) | inline scripts: ${r.inlineScripts}`,
    );
    console.log(`  JS ${kb(r.jsTotalGzip)} gzip total | CSS ${kb(r.cssTotalGzip)} gzip total`);
    console.log(`  images (${r.imageCount}):`);
    for (const image of r.images.slice(0, 10)) console.log(`    ${image.slice(0, 140)}`);
    console.log(`  preloads (${r.preloads.length}):`);
    for (const p of r.preloads) console.log(`    ${p}`);
    console.log(`  scripts/assets by gzip size:`);
    for (const a of [...r.jsChunks, ...r.otherAssets]) {
      console.log(
        `    ${kb(a.gzipBytes).padStart(9)} ${String(a.status).padStart(3)} ${a.cacheControl.slice(0, 52).padEnd(52)} ${a.url.slice(0, 90)}`,
      );
    }
    console.log("");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
