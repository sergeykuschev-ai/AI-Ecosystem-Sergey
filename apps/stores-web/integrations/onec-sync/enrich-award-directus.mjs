import { fetchAwardCatalog } from "./award-source.mjs";
import { composeAwardDescription } from "./award-content.mjs";

function requireConfig() {
  const base = (process.env.DIRECTUS_URL || "").replace(/\/$/, "");
  const token = process.env.DIRECTUS_ADMIN_TOKEN || "";
  if (!base || !token) throw new Error("DIRECTUS_URL and DIRECTUS_ADMIN_TOKEN are required");
  return { base, token };
}

async function request(config, method, path, body) {
  const response = await fetch(config.base + path, {
    method,
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function targetProducts(config) {
  const query = new URLSearchParams({
    fields: "id,external_id,sku,name,stock_quantity,site_name,site_description,site_image,site_category",
    "filter[brand][_eq]": "AWARD",
    "filter[stock_quantity][_gt]": "0",
    limit: "-1",
  });
  const response = await request(config, "GET", `/items/miska_catalog_products?${query}`);
  return response?.data ?? [];
}

export async function enrichAwardSources(options = {}) {
  const config = requireConfig();
  const targets = await targetProducts(config);
  const official = await fetchAwardCatalog(options);
  const syncedAt = new Date().toISOString();

  const matches = [];
  const unmatched = [];
  for (const product of targets) {
    const match = product.sku ? official.bySku.get(String(product.sku).trim()) : null;
    if (!match) {
      unmatched.push({ externalId: product.external_id, sku: product.sku, name: product.name });
      continue;
    }
    matches.push({ product, official: match });
  }

  if (options.dryRun) {
    return {
      targets: targets.length,
      matched: matches.length,
      unmatched,
      sourceProducts: official.products.length,
      sourceFailures: official.failures,
      dryRun: true,
    };
  }

  for (const { product, official: source } of matches) {
    const siteName = product.site_name || source.title;
    const siteDescription = product.site_description || composeAwardDescription({
      title: siteName,
      sourceDescription: source.description,
      siteCategory: product.site_category,
    });
    await request(config, "PATCH", `/items/miska_catalog_products/${product.id}`, {
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
    targets: targets.length,
    matched: matches.length,
    unmatched,
    sourceProducts: official.products.length,
    sourceFailures: official.failures,
    updated: matches.length,
    contentSyncedAt: syncedAt,
  };
}

if (process.argv[1]?.endsWith("enrich-award-directus.mjs")) {
  const dryRun = process.argv.includes("--dry-run");
  console.log(JSON.stringify(await enrichAwardSources({ dryRun }), null, 2));
}
