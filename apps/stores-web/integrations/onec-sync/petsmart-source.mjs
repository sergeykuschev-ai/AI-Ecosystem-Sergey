import { getPetsmartBrandConfig } from "./petsmart-brand-config.mjs";

const ROOT = "https://petsmart.ru";

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function nextData(html, url) {
  const match = String(html).match(/<script id=["']__NEXT_DATA__["'] type=["']application\/json["']>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error(url + ": __NEXT_DATA__ not found");
  return JSON.parse(match[1]);
}

function collectVendorObjects(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectVendorObjects(item, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  if (value.vendor_code && value.id && value.slug && value.name) out.push(value);
  for (const child of Object.values(value)) collectVendorObjects(child, out);
  return out;
}

export function parsePetsmartBrandPage(html, url) {
  const data = nextData(html, url);
  const scope = data?.props?.pageProps?.serializedScope;
  if (!scope) throw new Error(url + ": serializedScope missing");
  const byCode = new Map();
  for (const item of collectVendorObjects(scope)) {
    const code = clean(item.vendor_code);
    const row = { id: Number(item.id), vendorCode: code, slug: clean(item.slug), name: clean(item.name) };
    const current = byCode.get(code);
    if (current && (current.id !== row.id || current.slug !== row.slug || current.name !== row.name)) {
      throw new Error(url + ": conflicting vendor_code " + code);
    }
    byCode.set(code, row);
  }
  return byCode;
}
function originalImageUrl(proxyUrl) {
  const value = clean(proxyUrl);
  if (!value) return "";
  try {
    const parsed = new URL(value);
    const encoded = parsed.pathname.split("/").filter(Boolean).at(-1) || "";
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    const original = new URL(decoded);
    if (original.hostname !== "petsmart.ru" && original.hostname !== "www.petsmart.ru") return "";
    return original.href;
  } catch {
    return "";
  }
}

export function parsePetsmartProductPage(html, url) {
  const data = nextData(html, url);
  const product = data?.props?.pageProps?.pageProps?.data?.product;
  if (!product?.vendor_code || !product?.id || !product?.name) {
    throw new Error(url + ": product data missing");
  }
  const large = product?.primary_image?.web?.large;
  const proxyImage = Array.isArray(large) && large.length ? large.at(-1)?.url : "";
  const imageUrl = originalImageUrl(proxyImage);
  if (!imageUrl) throw new Error(url + ": original product image missing");
  return {
    id: Number(product.id),
    vendorCode: clean(product.vendor_code),
    name: clean(product.name),
    description: clean(product.description),
    imageUrl,
    sourceUrl: url,
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "AmurskMarket-MiskaCatalog/1.0" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(url + ": HTTP " + response.status);
  return response.text();
}

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}
export async function fetchPetsmartBrandProducts(brand, vendorCodes = [], { concurrency = 5 } = {}) {
  const config = getPetsmartBrandConfig(brand);
  const index = new Map();
  const failures = [];

  for (const page of config.pages) {
    try {
      const parsed = parsePetsmartBrandPage(await fetchText(page), page);
      for (const [code, row] of parsed) {
        const current = index.get(code);
        if (current && (current.id !== row.id || current.slug !== row.slug || current.name !== row.name)) {
          throw new Error("conflicting brand index for vendor_code " + code);
        }
        index.set(code, row);
      }
    } catch (error) {
      failures.push({ page, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const wanted = [...new Set(vendorCodes.map((x) => clean(x)).filter(Boolean))];
  const rows = await mapLimit(wanted, concurrency, async (code) => {
    const entry = index.get(code);
    if (!entry) return { code, product: null, reason: "vendor_code not found in official brand pages" };
    const url = ROOT + "/xabarovsk/product/" + entry.id + "-" + entry.slug;
    try {
      const product = parsePetsmartProductPage(await fetchText(url), url);
      if (product.vendorCode !== code) throw new Error("vendor_code mismatch: " + product.vendorCode);
      return { code, product };
    } catch (error) {
      failures.push({ code, url, error: error instanceof Error ? error.message : String(error) });
      return { code, product: null, reason: "product page validation failed" };
    }
  });

  return {
    brand,
    indexSize: index.size,
    rows,
    byVendorCode: new Map(rows.filter((row) => row.product).map((row) => [row.code, row.product])),
    failures,
  };
}
