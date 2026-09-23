const AWARD_PRODUCT_SITEMAP = "https://awardpetfood.ru/sitemap/product.xml";

function decodeHtml(value) {
  return String(value ?? "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'");
}

function attr(html, itemprop, tag = "(?:meta|link)") {
  const a = new RegExp(`<${tag}\\b[^>]*(?:content|href)="([^"]*)"[^>]*itemprop="${itemprop}"[^>]*>`, "i");
  const b = new RegExp(`<${tag}\\b[^>]*itemprop="${itemprop}"[^>]*(?:content|href)="([^"]*)"[^>]*>`, "i");
  const match = html.match(a) ?? html.match(b);
  return match ? decodeHtml(match[1].trim()) : "";
}

export function parseAwardProductPage(html, url) {
  const productStart = html.search(/itemtype="https:\/\/schema\.org\/Product"/i);
  if (productStart < 0) throw new Error(`${url}: Product microdata not found`);
  const window = html.slice(productStart, productStart + 25000);
  const sku = attr(window, "sku");
  const title = attr(window, "name");
  const description = attr(window, "description");
  const imageUrl = attr(window, "image", "link");
  if (!sku || !title || !description || !imageUrl) {
    throw new Error(`${url}: incomplete Product microdata`);
  }
  return { sku, title, description, imageUrl, sourceUrl: url };
}

export function parseSitemap(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decodeHtml(match[1].trim()));
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "AmurskMarket-MiskaCatalog/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
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

export async function fetchAwardCatalog(options = {}) {
  const sitemapUrl = options.sitemapUrl ?? AWARD_PRODUCT_SITEMAP;
  const sitemap = await fetchText(sitemapUrl);
  const urls = parseSitemap(sitemap);
  const failures = [];
  const pages = await mapLimit(urls, options.concurrency ?? 4, async (url) => {
    try {
      return parseAwardProductPage(await fetchText(url), url);
    } catch (error) {
      failures.push({ url, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  });
  const products = pages.filter(Boolean);
  const bySku = new Map();
  for (const product of products) {
    if (bySku.has(product.sku)) throw new Error(`duplicate official AWARD SKU: ${product.sku}`);
    bySku.set(product.sku, product);
  }
  return { products, bySku, failures, sourceCount: urls.length };
}
