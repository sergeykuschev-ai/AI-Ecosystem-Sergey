import { getValtaSiteBrandConfig } from "./valta-site-brand-config.mjs";

const ROOT_SITEMAP = "https://valta.ru/sitemap.xml";

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
  return decode(String(value ?? "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

export function parseSitemap(xml) {
  return [...String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1].trim()));
}

function firstMatch(html, regex) {
  const match = String(html).match(regex);
  return match ? decode(match[1].trim()) : "";
}

function descriptionTab(html) {
  const match = String(html).match(/<div class="b-tabs__item active"[^>]*data-tab-body="1"[^>]*>([\s\S]*?)<div class="b-tabs__item"[^>]*data-tab-body="3"/i);
  if (!match) return "";
  return stripTags(match[1]).replace(/Читать полностью\s*Скрыть\s*$/i, "").trim();
}

function barcodeBlock(html) {
  const match = String(html).match(/<span itemprop=["']name["']>Штрих-код<\/span>\s*<div>([\s\S]*?)<\/div>\s*<\/div>/i);
  if (!match) return [];
  return [...stripTags(match[1]).matchAll(/\d{8,14}/g)].map((m) => m[0]);
}

function firstProductImage(html) {
  const source = String(html);
  const thumbsIndex = source.indexOf("detail-slider__thumbs");
  if (thumbsIndex >= 0) {
    const thumbs = source.slice(thumbsIndex, thumbsIndex + 50000);
    const candidates = [];
    for (const match of thumbs.matchAll(/(?:src|data-src)=["'](https:\/\/valta-s3-bitrix-upload[^"']+)["']/gi)) {
      candidates.push(match[1]);
    }
    const preferred = candidates.find((url) => /\/webp\//i.test(url) && !/resize_cache/i.test(url))
      ?? candidates.find((url) => !/resize_cache/i.test(url));
    if (preferred) return preferred;
  }
  const index = source.indexOf("detail-slider__inner");
  if (index < 0) return "";
  const window = source.slice(index, index + 50000);
  return firstMatch(window, /<a[^>]+href=["'](https:\/\/valta-s3-bitrix-upload[^"']+)["']/i);
}

export function parseValtaProductPage(html, url) {
  const title = stripTags(firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i));
  const sku = firstMatch(html, /<meta\s+itemprop=["']sku["']\s+content=["']([^"']+)/i)
    || stripTags(firstMatch(html, /Арт\.\s*:?[\s\S]{0,60}?([A-Za-zА-Яа-я0-9-]{3,})/i));
  const brand = stripTags(firstMatch(html, /<span itemprop=["']name["']>Бренд<\/span>\s*<span itemprop=["']value["']>\s*(?:<a[^>]*>)?([^<]+)/i));
  const description = descriptionTab(html);
  const imageUrl = firstProductImage(html);
  const barcodes = barcodeBlock(html);

  if (!title || !sku || !description || !imageUrl) {
    throw new Error(url + ": incomplete Valta product page");
  }

  return { title, sku, brand, description, imageUrl, barcodes, sourceUrl: url };
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

async function allCatalogUrls() {
  const root = await fetchText(ROOT_SITEMAP);
  const children = parseSitemap(root);
  const xmls = await mapLimit(children, 4, async (url) => {
    try { return await fetchText(url); } catch { return ""; }
  });
  const urls = [];
  for (const xml of xmls) {
    for (const url of parseSitemap(xml)) if (url.includes("/catalog/")) urls.push(url);
  }
  return [...new Set(urls)];
}

export async function fetchValtaSiteBrandCatalog(brand, options = {}) {
  const config = getValtaSiteBrandConfig(brand);
  const urls = (await allCatalogUrls()).filter((url) => {
    const lower = url.toLocaleLowerCase("ru-RU");
    return config.urlTokens.some((token) => lower.includes(token));
  });
  const failures = [];
  const pages = await mapLimit(urls, options.concurrency ?? 8, async (url) => {
    try {
      const product = parseValtaProductPage(await fetchText(url), url);
      return product;
    } catch (error) {
      failures.push({ url, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  });
  const products = pages.filter(Boolean);
  const bySku = new Map();
  const byBarcode = new Map();
  for (const product of products) {
    const sku = String(product.sku).trim();
    if (!bySku.has(sku)) bySku.set(sku, product);
    for (const barcode of product.barcodes) if (!byBarcode.has(barcode)) byBarcode.set(barcode, product);
  }
  return { brand, products, bySku, byBarcode, failures, sourceCount: urls.length };
}
