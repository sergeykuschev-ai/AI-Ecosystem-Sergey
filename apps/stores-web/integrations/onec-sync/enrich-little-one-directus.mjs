import { fetchLittleOneCatalog } from "./little-one-source.mjs";
import { composePetProductDescription } from "./pet-content.mjs";

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
    fields: "id,external_id,sku,barcode,name,site_name,site_description,site_image,site_category",
    "filter[brand][_eq]": "Little One",
    "filter[stock_quantity][_gt]": "0",
    limit: "-1",
  });
  const response = await request(config, "GET", "/items/miska_catalog_products?" + query);
  return response?.data ?? [];
}

function siteName(source) {
  const title = String(source.title || "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/g, "");
  const pack = String(source.packaging || "").replace(/\s+/g, " ").trim();
  if (!pack || title.toLocaleLowerCase("ru-RU").includes(pack.toLocaleLowerCase("ru-RU"))) return title;
  return title + ", " + pack;
}

export async function enrichLittleOne(options = {}) {
  const config = requireConfig();
  const products = await targets(config);
  const official = await fetchLittleOneCatalog(products.map((item) => item.sku).filter(Boolean));
  const matched = [];
  const unmatched = [];

  for (const product of products) {
    const source = product.sku ? official.bySku.get(String(product.sku)) : null;
    if (!source) {
      unmatched.push({ externalId: product.external_id, sku: product.sku, barcode: product.barcode, name: product.name });
      continue;
    }
    matched.push({ product, source });
  }

  if (options.dryRun) {
    return {
      brand: "Little One",
      targets: products.length,
      matched: matched.length,
      unmatched,
      sourceProducts: official.products.length,
      sourceFailures: official.failures,
      samples: matched.slice(0, 8).map(({ product, source }) => ({
        local: product.name,
        official: siteName(source),
        ean: source.ean,
        hasImage: Boolean(source.imageUrl),
      })),
      dryRun: true,
    };
  }

  const syncedAt = new Date().toISOString();
  for (const { product, source } of matched) {
    const name = product.site_name || siteName(source);
    const description = product.site_description || composePetProductDescription({
      title: name,
      sourceDescription: source.description,
      siteCategory: product.site_category,
    });
    await request(config, "PATCH", "/items/miska_catalog_products/" + product.id, {
      site_name: name,
      site_description: description,
      content_source_url: source.sourceUrl,
      image_source_url: source.imageUrl || null,
      source_title: source.title,
      source_description: source.description,
      content_status: description && product.site_image ? "ready" : "enriching",
      content_synced_at: syncedAt,
    });
  }

  return {
    brand: "Little One",
    targets: products.length,
    matched: matched.length,
    unmatched,
    sourceFailures: official.failures,
    updated: matched.length,
    contentSyncedAt: syncedAt,
  };
}

if (process.argv[1]?.endsWith("enrich-little-one-directus.mjs")) {
  console.log(JSON.stringify(await enrichLittleOne({ dryRun: process.argv.includes("--dry-run") }), null, 2));
}
