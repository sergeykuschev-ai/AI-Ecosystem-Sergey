const ROOT = "https://www.mealberry.ru";
const CATALOG_URL = ROOT + "/catalog/?brand%5B%5D=336&ajax=Y";

function decode(value) {
  return String(value ?? "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'");
}

function clean(value) {
  return decode(String(value ?? "").replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function absolute(value, base = ROOT) {
  if (!value) return "";
  return new URL(value, base).href;
}

export function parseLittleOneCatalog(html) {
  const blocks = String(html).split(/<div\s+class=["'][^"']*card-list-item\s*["'][^>]*>/i).slice(1);
  const bySku = new Map();
  for (const block of blocks) {
    const link = block.match(/<a\s+href=["']([^"']+)["']\s+class=["']card-list-name["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const sourceUrl = absolute(link[1]);
    const familyTitle = clean(link[2]);
    const variants = [...block.matchAll(/<li>[\s\S]*?<div\s+class=["']text["']>([\s\S]*?)<\/div>[\s\S]*?<div\s+class=["']value["']>\s*АРТ\.\s*([^<\s]+)[\s\S]*?<\/div>[\s\S]*?<\/li>/gi)];
    for (const match of variants) {
      const packaging = clean(match[1]);
      const sku = clean(match[2]);
      if (!sku || bySku.has(sku)) continue;
      bySku.set(sku, { sku, packaging, familyTitle, sourceUrl });
    }
  }
  return bySku;
}

function mainImageTags(html) {
  const start = html.search(/class=["'][^"']*\bjs-product-pictures\b/i);
  if (start < 0) return [];
  const end = html.indexOf("product-catalog-info-wrap", start);
  const fragment = html.slice(start, end > start ? end : start + 30000);
  return fragment.match(/<img\b[^>]*>/gi) ?? [];
}

function attr(tag, name) {
  const match = tag.match(new RegExp(name + "=[\\\"']([^\\\"']*)[\\\"']", "i"));
  return match ? decode(match[1].trim()) : "";
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^$()|[\]{}\\]/g, "\\$&");
}

export function parseLittleOneProductPage(html, variant) {
  const title = clean(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? variant.familyTitle);
  const descMatch = html.match(/<div\s+class=["'][^"']*product-catalog__description[^"']*["'][^>]*>[\s\S]*?<div\s+class=["']text["'][^>]*>([\s\S]*?)<\/div>/i);
  const description = clean(descMatch?.[1] ?? "");
  const packagingBlock = html.match(/<ul\s+class=["'][^"']*packing-info[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i)?.[1] ?? "";
  let ean = "";
  for (const row of packagingBlock.matchAll(/<li>([\s\S]*?)<\/li>/gi)) {
    const text = clean(row[1]);
    if (new RegExp("АРТ\\.\\s*" + escapeRegex(variant.sku) + "\\b", "i").test(text)) {
      ean = text.match(/EAN\s*(\d{8,14})/i)?.[1] ?? "";
      break;
    }
  }

  const candidates = mainImageTags(html).map((tag) => absolute(attr(tag, "src"), variant.sourceUrl)).filter(Boolean);
  const exact = candidates.find((url) => (ean && url.includes(ean)) || url.includes(variant.sku)) ?? "";
  const imageUrl = exact || (candidates.length === 1 ? candidates[0] : "");

  return { sku: variant.sku, ean, title, packaging: variant.packaging, description, imageUrl, sourceUrl: variant.sourceUrl };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "AmurskMarket-MiskaCatalog/1.0", "X-Requested-With": "XMLHttpRequest" },
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(url + ": HTTP " + response.status);
  return response.text();
}

export async function fetchLittleOneCatalog(targetSkus = []) {
  const variants = parseLittleOneCatalog(await fetchText(CATALOG_URL));
  const wanted = targetSkus.length ? targetSkus : [...variants.keys()];
  const pages = new Map();
  const products = [];
  const failures = [];

  for (const sku of wanted) {
    const variant = variants.get(String(sku));
    if (!variant) {
      failures.push({ sku, error: "official SKU not found in Little One catalog" });
      continue;
    }
    try {
      if (!pages.has(variant.sourceUrl)) pages.set(variant.sourceUrl, await fetchText(variant.sourceUrl));
      products.push(parseLittleOneProductPage(pages.get(variant.sourceUrl), variant));
    } catch (error) {
      failures.push({ sku, url: variant.sourceUrl, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { products, bySku: new Map(products.map((p) => [p.sku, p])), failures, catalogSkus: variants.size };
}
