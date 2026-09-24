import { fetchPetsmartBrandProducts } from "./petsmart-source.mjs";
import { getPetsmartBrandConfig } from "./petsmart-brand-config.mjs";
import { validatePetsmartVariant } from "./petsmart-match.mjs";

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

async function targets(config, brand) {
  const query = new URLSearchParams({
    fields: "id,external_id,sku,barcode,name,site_name,site_description,site_image,site_category",
    "filter[brand][_eq]": brand,
    "filter[stock_quantity][_gt]": "0",
    limit: "-1",
  });
  return (await request(config, "GET", "/items/miska_catalog_products?" + query))?.data ?? [];
}

function conciseDescription(source) {
  const title = String(source.name || "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/g, "");
  return title ? title + "." : "";
}
export async function enrichPetsmartBrand(brand, { dryRun = false } = {}) {
  getPetsmartBrandConfig(brand);
  const config = requireConfig();
  const products = await targets(config, brand);
  const official = await fetchPetsmartBrandProducts(brand, products.map((item) => item.sku).filter(Boolean));
  const matched = [];
  const unmatched = [];

  for (const product of products) {
    const source = product.sku ? official.byVendorCode.get(String(product.sku).trim()) : null;
    if (!source) {
      unmatched.push({
        externalId: product.external_id,
        sku: product.sku,
        barcode: product.barcode,
        name: product.name,
        reason: product.sku ? "exact vendor_code not found" : "no vendor_code in 1C",
      });
      continue;
    }
    const validation = validatePetsmartVariant(product.name, source.name);
    if (!validation.ok) {
      unmatched.push({
        externalId: product.external_id,
        sku: product.sku,
        barcode: product.barcode,
        name: product.name,
        officialName: source.name,
        reason: validation.reason,
      });
      continue;
    }
    matched.push({ product, source });
  }

  if (dryRun) {
    return {
      brand,
      targets: products.length,
      matched: matched.length,
      unmatched,
      indexSize: official.indexSize,
      sourceFailures: official.failures,
      dryRun: true,
      samples: matched.slice(0, 20).map(({ product, source }) => ({
        local: product.name,
        official: source.name,
        sku: product.sku,
        image: Boolean(source.imageUrl),
      })),
    };
  }

  const syncedAt = new Date().toISOString();
  for (const { product, source } of matched) {
    const description = product.site_description || conciseDescription(source);
    await request(config, "PATCH", "/items/miska_catalog_products/" + product.id, {
      site_name: product.site_name || source.name,
      site_description: description,
      content_source_url: source.sourceUrl,
      image_source_url: source.imageUrl,
      source_title: source.name,
      source_description: source.description,
      content_status: description && product.site_image ? "ready" : "enriching",
      content_synced_at: syncedAt,
    });
  }

  return {
    brand,
    targets: products.length,
    matched: matched.length,
    unmatched,
    indexSize: official.indexSize,
    sourceFailures: official.failures,
    updated: matched.length,
    contentSyncedAt: syncedAt,
  };
}

if (process.argv[1]?.endsWith("enrich-petsmart-brand-directus.mjs")) {
  const brand = process.argv[2];
  if (!brand) throw new Error("usage: node enrich-petsmart-brand-directus.mjs <brand> [--dry-run]");
  console.log(JSON.stringify(await enrichPetsmartBrand(brand, { dryRun: process.argv.includes("--dry-run") }), null, 2));
}
