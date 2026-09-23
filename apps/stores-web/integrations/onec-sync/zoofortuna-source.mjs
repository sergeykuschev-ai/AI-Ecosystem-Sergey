function decode(value) {
  return String(value ?? "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripTags(value) {
  return decode(String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function first(html, regex) {
  const match = String(html).match(regex);
  return match ? decode(match[1].trim()) : "";
}

export function parseZooFortunaProductPage(html, url) {
  const title = stripTags(first(html, /<h1[^>]*class=["'][^"']*product_title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i));
  const sku = stripTags(first(html, /<span[^>]*class=["']sku["'][^>]*>([\s\S]*?)<\/span>/i));
  const description = stripTags(first(html, /<div[^>]*class=["'][^"']*woocommerce-product-details__short-description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i));

  const gallery = first(html, /<div[^>]*class=["'][^"']*woocommerce-product-gallery__wrapper[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  let imageUrl = "";
  for (const tag of gallery.match(/<img\b[^>]*>/gi) ?? []) {
    const src = first(tag, /\bsrc=["']([^"']+)["']/i);
    if (src && !/woocommerce-placeholder/i.test(src)) {
      imageUrl = src;
      break;
    }
  }

  if (!title || !sku) throw new Error(url + ": incomplete ZooFortuna product page");
  return { title, sku, description, imageUrl, sourceUrl: url };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "AmurskMarket-MiskaCatalog/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(url + ": HTTP " + response.status);
  return response.text();
}

function normalizeSku(value) {
  return String(value ?? "").trim().toLocaleLowerCase("ru-RU");
}

export async function findZooFortunaProductBySku(sku) {
  const value = String(sku ?? "").trim();
  if (!value) return null;
  const search = new URL("https://zoo-fortyna.ru/wp-json/wp/v2/product");
  search.searchParams.set("search", value);
  search.searchParams.set("per_page", "5");
  const response = await fetch(search, {
    headers: { "User-Agent": "AmurskMarket-MiskaCatalog/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(search.href + ": HTTP " + response.status);
  const candidates = await response.json();
  for (const candidate of candidates) {
    if (!candidate?.link) continue;
    try {
      const product = parseZooFortunaProductPage(await fetchText(candidate.link), candidate.link);
      if (normalizeSku(product.sku) === normalizeSku(value)) return product;
    } catch {
      // Try the next search result.
    }
  }
  return null;
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

export async function fetchZooFortunaBySkus(skus, { concurrency = 8 } = {}) {
  const unique = [...new Set(skus.map((x) => String(x ?? "").trim()).filter(Boolean))];
  const failures = [];
  const rows = await mapLimit(unique, concurrency, async (sku) => {
    try {
      const product = await findZooFortunaProductBySku(sku);
      return product ? { sku, product } : { sku, product: null };
    } catch (error) {
      failures.push({ sku, error: error instanceof Error ? error.message : String(error) });
      return { sku, product: null };
    }
  });
  const bySku = new Map();
  for (const row of rows) if (row.product) bySku.set(normalizeSku(row.sku), row.product);
  return { bySku, failures, requested: unique.length, matched: bySku.size };
}
