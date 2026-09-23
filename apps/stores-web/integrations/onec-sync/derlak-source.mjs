const SITEMAP = "https://derlak.ru/sitemap-iblock-1.xml";

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
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function absolute(value, url) {
  try { return new URL(value, url).href; } catch { return ""; }
}

export function parseSitemap(xml) {
  return [...String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1].trim()));
}

export function parseDerlakProductPage(html, url) {
  const titleMatch = String(html).match(/<h1[^>]*class=["'][^"']*product-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
  const skuMatch = String(html).match(/<div[^>]*class=["'][^"']*product-artnumber[^"']*["'][^>]*>\s*Артикул:\s*([^<\s]+)[\s\S]*?<\/div>/i);
  const leadMatch = String(html).match(/<p[^>]*class=["'][^"']*lead[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
  const imageMatch = String(html).match(/<div[^>]*class=["'][^"']*main-photo[^"']*["'][^>]*>[\s\S]{0,2000}?<img[^>]+src=["']([^"']+)["']/i);

  const title = stripTags(titleMatch?.[1] ?? "");
  const sku = stripTags(skuMatch?.[1] ?? "");
  const description = stripTags(leadMatch?.[1] ?? "");
  const imageUrl = absolute(imageMatch?.[1] ?? "", url);
  if (!title || !sku || !description || !imageUrl) throw new Error(url + ": incomplete Derlak product page");

  const species = url.includes("/catalog/cats/") ? "Кошки" : url.includes("/catalog/dogs/") ? "Собаки" : null;
  return { title, sku, description, imageUrl, sourceUrl: url, species };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "AmurskMarket-MiskaCatalog/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(url + ": HTTP " + response.status);
  return response.text();
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

export async function fetchDerlakBySkus(skus, { concurrency = 8 } = {}) {
  const wanted = new Set(skus.map((x) => String(x ?? "").trim()).filter(Boolean));
  const urls = parseSitemap(await fetchText(SITEMAP));
  const selected = [];
  for (const url of urls) {
    for (const sku of wanted) {
      if (url.includes("-art-" + sku + "/") || url.includes("-art-" + sku.toLocaleLowerCase("ru-RU") + "/")) {
        selected.push({ sku, url });
        break;
      }
    }
  }

  const failures = [];
  const pages = await mapLimit(selected, concurrency, async ({ sku, url }) => {
    try {
      const product = parseDerlakProductPage(await fetchText(url), url);
      return { sku, product };
    } catch (error) {
      failures.push({ sku, url, error: error instanceof Error ? error.message : String(error) });
      return { sku, product: null };
    }
  });

  const bySku = new Map();
  for (const row of pages) {
    if (row.product && String(row.product.sku).trim() === row.sku) bySku.set(row.sku, row.product);
  }
  return { bySku, failures, requested: wanted.size, selected: selected.length, matched: bySku.size };
}
