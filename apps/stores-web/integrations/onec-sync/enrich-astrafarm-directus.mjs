import { fetchAstraFarmByBarcodes } from "./astrafarm-source.mjs";

function requireConfig() {
  const base = (process.env.DIRECTUS_URL || "").replace(/\/$/, "");
  const token = process.env.DIRECTUS_ADMIN_TOKEN || "";
  if (!base || !token) throw new Error("DIRECTUS_URL and DIRECTUS_ADMIN_TOKEN are required");
  return { base, token };
}

async function request(config, method, path, body) {
  const response = await fetch(config.base + path, {
    method,
    headers: { Authorization: "Bearer " + config.token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(method + " " + path + ": " + response.status + " " + await response.text());
  return response.status === 204 ? null : response.json();
}

async function targets(config) {
  const query = new URLSearchParams({
    fields: "id,external_id,sku,barcode,name,site_name,site_description,site_image",
    "filter[brand][_eq]": "КонтрСекс NEO",
    "filter[stock_quantity][_gt]": "0",
    limit: "-1",
  });
  const response = await request(config, "GET", "/items/miska_catalog_products?" + query);
  return response?.data ?? [];
}
function description(source) {
  const sourceText = String(source.description || "")
    .replace(/\s*[–—-]\s*доступный и безопасный препарат/i, " – препарат")
    .replace(/\s+/g, " ")
    .trim();
  return sourceText.replace(/[.\s]+$/g, "") + ".";
}

export async function enrichAstraFarm(options = {}) {
  const config = requireConfig();
  const products = await targets(config);
  const official = await fetchAstraFarmByBarcodes(products.map((item) => item.barcode));
  const matched = [];
  const unmatched = [];
  for (const product of products) {
    const source = product.barcode ? official.byBarcode.get(String(product.barcode)) : null;
    if (!source) { unmatched.push({ externalId: product.external_id, barcode: product.barcode, name: product.name }); continue; }
    matched.push({ product, source });
  }
  if (options.dryRun) return {
    brand: "КонтрСекс NEO", targets: products.length, matched: matched.length, unmatched,
    sourceFailures: official.failures, dryRun: true,
  };

  const syncedAt = new Date().toISOString();
  for (const { product, source } of matched) {
    await request(config, "PATCH", "/items/miska_catalog_products/" + product.id, {
      site_name: product.site_name || source.title,
      site_description: product.site_description || description(source),
      content_source_url: source.sourceUrl,
      image_source_url: source.imageUrl,
      source_title: source.title,
      source_description: source.description,
      content_status: product.site_image ? "ready" : "enriching",
      content_synced_at: syncedAt,
    });
  }
  return { brand: "КонтрСекс NEO", targets: products.length, matched: matched.length, unmatched, updated: matched.length, sourceFailures: official.failures };
}
if (process.argv[1]?.endsWith("enrich-astrafarm-directus.mjs")) {
  console.log(JSON.stringify(await enrichAstraFarm({ dryRun: process.argv.includes("--dry-run") }), null, 2));
}
