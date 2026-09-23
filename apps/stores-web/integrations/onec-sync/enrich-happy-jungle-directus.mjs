import { fetchHappyJungleCatalog } from "./happy-jungle-source.mjs";
import { composePetProductDescription } from "./pet-content.mjs";
import { validateOfficialMatch } from "./official-match.mjs";

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
    fields: "id,external_id,sku,barcode,name,stock_quantity,site_name,site_description,site_image,site_category",
    "filter[brand][_eq]": "Happy Jungle",
    "filter[stock_quantity][_gt]": "0",
    limit: "-1",
  });
  return (await request(config, "GET", "/items/miska_catalog_products?" + query))?.data ?? [];
}

function exactSource(product, source) {
  const sku = product.sku ? String(product.sku).trim() : "";
  const barcode = product.barcode ? String(product.barcode).trim() : "";
  return (sku && source.bySku.get(sku)) || (barcode && source.byBarcode.get(barcode)) || null;
}

export async function enrichHappyJungle({ dryRun = false } = {}) {
  const config = requireConfig();
  const local = await targets(config);
  const source = await fetchHappyJungleCatalog();
  const matched = [];
  const unmatched = [];

  for (const product of local) {
    const official = exactSource(product, source);
    if (!official) {
      unmatched.push({ externalId: product.external_id, sku: product.sku, barcode: product.barcode, name: product.name, reason: "exact SKU/barcode not found" });
      continue;
    }
    const validation = validateOfficialMatch(product.name, official.title);
    if (!validation.ok) {
      unmatched.push({ externalId: product.external_id, sku: product.sku, name: product.name, officialTitle: official.title, reason: validation.reason });
      continue;
    }
    matched.push({ product, official });
  }

  if (dryRun) return {
    brand: "Happy Jungle",
    targets: local.length,
    matched: matched.length,
    unmatched,
    sourceProducts: source.products.length,
    dryRun: true,
  };

  const syncedAt = new Date().toISOString();
  for (const { product, official } of matched) {
    const name = product.site_name || ("Happy Jungle — " + official.title);
    const description = product.site_description || composePetProductDescription({
      title: name,
      sourceDescription: official.description,
      siteCategory: product.site_category,
    });
    await request(config, "PATCH", "/items/miska_catalog_products/" + product.id, {
      site_name: name,
      site_description: description,
      content_source_url: official.sourceUrl,
      image_source_url: official.imageUrl,
      source_title: official.title,
      source_description: official.description,
      content_status: description && product.site_image ? "ready" : "enriching",
      content_synced_at: syncedAt,
    });
  }

  return {
    brand: "Happy Jungle",
    targets: local.length,
    matched: matched.length,
    unmatched,
    sourceProducts: source.products.length,
    updated: matched.length,
    contentSyncedAt: syncedAt,
  };
}

if (process.argv[1]?.endsWith("enrich-happy-jungle-directus.mjs")) {
  console.log(JSON.stringify(await enrichHappyJungle({ dryRun: process.argv.includes("--dry-run") }), null, 2));
}
