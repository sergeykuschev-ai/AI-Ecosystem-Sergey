import { getEkopromBrandConfig } from "./ekoprom-brand-config.mjs";

function decode(value) {
  return String(value ?? "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'");
}

function clean(value) {
  return decode(String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function originalImage(value, pageUrl) {
  if (!value) return "";
  return new URL(value.replace("/200x/", "/"), pageUrl).href;
}

export function parseEkopromBrandPage(html, pageUrl) {
  const source = String(html);
  const blocks = source.split(/<div\s+class=(?:"product"|'product'|product)>/i).slice(1);
  const products = [];

  for (const block of blocks) {
    const href = block.match(/<a\s+href=["']([^"']+)["']/i)?.[1] ?? "";
    const title = clean(block.match(/<div\s+class=(?:"title"|'title'|title)>[\s\S]*?<div\s+class=(?:"padder"|'padder'|padder)>([\s\S]*?)<\/div>/i)?.[1] ?? "");
    const image = block.match(/<div\s+class=(?:"image"|'image'|image)>\s*<img\s+src=["']([^"']+)["']/i)?.[1] ?? "";
    const sku = clean(block.match(/<div\s+class=(?:"code"|'code'|code)>([\s\S]*?)<\/div>/i)?.[1] ?? "");
    const intro = clean(block.match(/<div\s+class=(?:"introtext"|'introtext'|introtext)>([\s\S]*?)<\/div>/i)?.[1] ?? "");
    const properties = clean(block.match(/<div\s+class=(?:"properties"|'properties'|properties)>([\s\S]*?)<\/div>/i)?.[1] ?? "");
    const barcode = properties.match(/Штрихкод:\s*(\d{8,14})/i)?.[1] ?? "";
    const composition = properties.match(/Состав:\s*([\s\S]*?)(?=Кол-во|Вес\s*[–-]|Штрихкод|$)/i)?.[1]?.replace(/[.;\s]+$/g, "").trim() ?? "";

    if (!sku || !title || !image) continue;
    const description = [
      intro,
      composition ? "Состав: " + composition + "." : "",
    ].filter(Boolean).join(" ");

    products.push({
      sku,
      barcode,
      title,
      description,
      imageUrl: originalImage(image, pageUrl),
      sourceUrl: new URL(href, pageUrl).href,
    });
  }
  return products;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "AmurskMarket-MiskaCatalog/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(url + ": HTTP " + response.status);
  return response.text();
}

export async function fetchEkopromBrandCatalog(brand) {
  const config = getEkopromBrandConfig(brand);
  const products = parseEkopromBrandPage(await fetchText(config.url), config.url);
  const bySku = new Map();
  const byBarcode = new Map();
  for (const product of products) {
    if (!bySku.has(product.sku)) bySku.set(product.sku, product);
    if (product.barcode && !byBarcode.has(product.barcode)) byBarcode.set(product.barcode, product);
  }
  return { brand, products, bySku, byBarcode, sourceUrl: config.url };
}
