import { fetchValtaSiteBrandCatalog } from "./valta-site-source.mjs";
import { composePetProductDescription } from "./pet-content.mjs";
import { getValtaSiteBrandConfig } from "./valta-site-brand-config.mjs";
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

async function targetProducts(config, brand) {
  const query = new URLSearchParams({
    fields: "id,external_id,sku,barcode,name,stock_quantity,site_name,site_description,site_image,site_category",
    "filter[brand][_eq]": brand,
    "filter[stock_quantity][_gt]": "0",
    limit: "-1",
  });
  const response = await request(config, "GET", "/items/miska_catalog_products?" + query);
  return response?.data ?? [];
}

function exactSource(product, official) {
  const sku = product.sku ? String(product.sku).trim() : "";
  const barcode = product.barcode ? String(product.barcode).trim() : "";
  return (sku && official.bySku.get(sku)) || (barcode && official.byBarcode.get(barcode)) || null;
}

export async function enrichValtaSiteBrand(brand, options = {}) {
  getValtaSiteBrandConfig(brand);
  const directus = requireConfig();
  const targets = await targetProducts(directus, brand);
  const official = await fetchValtaSiteBrandCatalog(brand, {
    concurrency: options.concurrency ?? Number(process.env.SOURCE_CONCURRENCY || 8),
  });

  const matched = [];
  const unmatched = [];
  for (const product of targets) {
    const source = exactSource(product, official);
    if (!source) {
      unmatched.push({ externalId: product.external_id, sku: product.sku, barcode: product.barcode, name: product.name, reason: "exact SKU/barcode not found" });
      continue;
    }
    const validation = validateOfficialMatch(product.name, source.title);
    if (!validation.ok) {
      unmatched.push({ externalId: product.external_id, sku: product.sku, barcode: product.barcode, name: product.name, officialTitle: source.title, reason: validation.reason });
      continue;
    }
    matched.push({ product, source });
  }

  if (options.dryRun) {
    return {
      brand,
      targets: targets.length,
      matched: matched.length,
      unmatched,
      sourceProducts: official.products.length,
      sourceFailures: official.failures,
      dryRun: true,
    };
  }

  const syncedAt = new Date().toISOString();
  for (const { product, source } of matched) {
    const siteName = product.site_name || source.title;
    const siteDescription = product.site_description || composePetProductDescription({
      title: siteName,
      sourceDescription: source.description,
      siteCategory: product.site_category,
    });
    await request(directus, "PATCH", "/items/miska_catalog_products/" + product.id, {
      site_name: siteName,
      site_description: siteDescription,
      content_source_url: source.sourceUrl,
      image_source_url: source.imageUrl,
      source_title: source.title,
      source_description: source.description,
      content_status: siteDescription && product.site_image ? "ready" : "enriching",
      content_synced_at: syncedAt,
    });
  }

  return {
    brand,
    targets: targets.length,
    matched: matched.length,
    unmatched,
    sourceProducts: official.products.length,
    sourceFailures: official.failures,
    updated: matched.length,
    contentSyncedAt: syncedAt,
  };
}

if (process.argv[1]?.endsWith("enrich-valta-site-brand-directus.mjs")) {
  const brand = process.argv[2];
  if (!brand) throw new Error("usage: node enrich-valta-site-brand-directus.mjs <brand> [--dry-run]");
  console.log(JSON.stringify(await enrichValtaSiteBrand(brand, { dryRun: process.argv.includes("--dry-run") }), null, 2));
}
