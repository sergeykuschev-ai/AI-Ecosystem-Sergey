import { fetchSibCatForLocalName, sourceUrlForLocalName } from "./sibcat-source.mjs";
import { composeSibCatDescription } from "./sibcat-content.mjs";

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

async function targetProducts(config) {
  const query = new URLSearchParams({
    fields: "id,external_id,sku,barcode,name,stock_quantity,site_name,site_description,site_image,site_category",
    "filter[brand][_eq]": "Сибирская кошка",
    "filter[stock_quantity][_gt]": "0",
    limit: "-1",
  });
  const response = await request(config, "GET", "/items/miska_catalog_products?" + query);
  return response?.data ?? [];
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

export async function enrichSibCat(options = {}) {
  const directus = requireConfig();
  const targets = await targetProducts(directus);
  const failures = [];
  const results = await mapLimit(targets, options.concurrency ?? 6, async (product) => {
    if (!sourceUrlForLocalName(product.name)) {
      return { product, official: null, reason: "unsupported product family" };
    }
    try {
      const official = await fetchSibCatForLocalName(product.name);
      return { product, official, reason: official ? null : "official page not found" };
    } catch (error) {
      failures.push({ externalId: product.external_id, name: product.name, error: error instanceof Error ? error.message : String(error) });
      return { product, official: null, reason: "source fetch failed" };
    }
  });

  const matched = results.filter((row) => row.official);
  const unmatched = results.filter((row) => !row.official).map((row) => ({
    externalId: row.product.external_id,
    sku: row.product.sku,
    barcode: row.product.barcode,
    name: row.product.name,
    reason: row.reason,
  }));

  if (options.dryRun) {
    return {
      brand: "Сибирская кошка",
      targets: targets.length,
      matched: matched.length,
      unmatched,
      sourceFailures: failures,
      dryRun: true,
      samples: matched.slice(0, 10).map(({ product, official }) => ({
        local: product.name,
        official: official.title,
        sourceUrl: official.sourceUrl,
      })),
    };
  }

  const syncedAt = new Date().toISOString();
  for (const { product, official } of matched) {
    const name = product.site_name || ("Сибирская кошка — " + official.title);
    const description = product.site_description || composeSibCatDescription(official);
    await request(directus, "PATCH", "/items/miska_catalog_products/" + product.id, {
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
    brand: "Сибирская кошка",
    targets: targets.length,
    matched: matched.length,
    unmatched,
    sourceFailures: failures,
    updated: matched.length,
    contentSyncedAt: syncedAt,
  };
}

if (process.argv[1]?.endsWith("enrich-sibcat-directus.mjs")) {
  console.log(JSON.stringify(await enrichSibCat({
    dryRun: process.argv.includes("--dry-run"),
  }), null, 2));
}
