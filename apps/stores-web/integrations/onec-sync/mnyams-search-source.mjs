import { parseAwardProductPage } from "./award-source.mjs";

const ROOT = "https://mnyams.ru";

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "AmurskMarket-MiskaCatalog/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(url + ": HTTP " + response.status);
  return response.text();
}

export function parseMnyamsSearch(json, expectedSku) {
  const sku = String(expectedSku ?? "").trim();
  const hits = json?.results?.[0]?.hits ?? [];
  const exact = hits
    .map((hit) => hit?.document)
    .filter(Boolean)
    .filter((doc) => String(doc.sku ?? "").trim() === sku);
  if (exact.length > 1) throw new Error("duplicate exact Mnyams SKU in search: " + sku);
  if (!exact.length) return null;
  const doc = exact[0];
  if (!doc.slug || !doc.name) throw new Error("incomplete Mnyams search hit: " + sku);
  return {
    sku,
    title: String(doc.name).trim(),
    brand: String(doc.brand ?? "").trim(),
    slug: String(doc.slug).trim(),
    imageUrl: String(doc.image ?? "").trim(),
    sourceUrl: ROOT + "/product/" + String(doc.slug).trim(),
    searchSourceUrl: ROOT + "/search/?q=" + encodeURIComponent(sku),
  };
}

function imageCandidates(html, preferred = "") {
  const urls = [preferred];
  const filename = String(preferred).split("/").at(-1) || "";
  const stem = filename.match(/^([a-f0-9-]{30,})_1x1_\d+\.jpg$/i)?.[1] || "";
  if (!stem) return [...new Set(urls.filter(Boolean))];
  const regex = new RegExp(stem + "_1x1_\\d+\\.jpg", "gi");
  for (const match of String(html).matchAll(regex)) {
    urls.push("https://cdn.valtabrands.ru/" + match[0]);
  }
  return [...new Set(urls.filter(Boolean))];
}

async function liveImage(html, preferred) {
  for (const url of imageCandidates(html, preferred).slice(0, 30)) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "AmurskMarket-MiskaCatalog/1.0", Range: "bytes=0-0" },
        signal: AbortSignal.timeout(8000),
      });
      const type = String(response.headers.get("content-type") || "");
      if ((response.ok || response.status === 206) && type.startsWith("image/")) {
        await response.body?.cancel();
        return url;
      }
      await response.body?.cancel();
    } catch {}
  }
  return "";
}

export async function findMnyamsBySku(sku) {
  const value = String(sku ?? "").trim();
  if (!value) return null;
  const searchUrl = ROOT + "/search/?q=" + encodeURIComponent(value);
  const search = JSON.parse(await fetchText(searchUrl));
  const hit = parseMnyamsSearch(search, value);
  if (!hit) return null;
  try {
    const html = await fetchText(hit.sourceUrl);
    const product = parseAwardProductPage(html, hit.sourceUrl);
    if (String(product.sku).trim() !== value) {
      throw new Error("Mnyams SKU mismatch: expected " + value + ", got " + product.sku);
    }
    return {
      ...product,
      brand: hit.brand,
      imageUrl: await liveImage(html, product.imageUrl),
      searchTitle: hit.title,
      searchImageUrl: hit.imageUrl,
      searchOnly: false,
    };
  } catch (error) {
    const imageUrl = await liveImage("", hit.imageUrl);
    if (!imageUrl) throw error;
    return {
      sku: value,
      title: hit.title,
      brand: hit.brand,
      description: "",
      imageUrl,
      sourceUrl: hit.searchSourceUrl,
      searchTitle: hit.title,
      searchImageUrl: hit.imageUrl,
      searchOnly: true,
    };
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export async function fetchMnyamsBySkus(skus = [], { concurrency = 6 } = {}) {
  const wanted = [...new Set(skus.map((x) => String(x ?? "").trim()).filter(Boolean))];
  const failures = [];
  const rows = await mapLimit(wanted, concurrency, async (sku) => {
    try {
      return { sku, product: await findMnyamsBySku(sku) };
    } catch (error) {
      failures.push({ sku, error: error instanceof Error ? error.message : String(error) });
      return { sku, product: null };
    }
  });
  return {
    rows,
    bySku: new Map(rows.filter((row) => row.product).map((row) => [row.sku, row.product])),
    failures,
  };
}
