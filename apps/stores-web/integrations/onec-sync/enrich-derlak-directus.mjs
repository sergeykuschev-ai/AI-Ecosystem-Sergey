import { fetchDerlakBySkus } from "./derlak-source.mjs";
import { composeDerlakDescription } from "./derlak-content.mjs";

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
    "filter[brand][_eq]": "Деревенские Лакомства",
    "filter[stock_quantity][_gt]": "0",
    limit: "-1",
  });
  const response = await request(config, "GET", "/items/miska_catalog_products?" + query);
  return response?.data ?? [];
}

export async function enrichDerlak(options = {}) {
  const directus = requireConfig();
  const targets = await targetProducts(directus);
  const source = await fetchDerlakBySkus(targets.map((item) => item.sku), {
    concurrency: options.concurrency ?? Number(process.env.SOURCE_CONCURRENCY || 8),
  });

  const matched = [];
  const unmatched = [];
  for (const product of targets) {
    const sku = product.sku ? String(product.sku).trim() : "";
    const official = sku ? source.bySku.get(sku) : null;
    if (!official) {
      unmatched.push({ externalId: product.external_id, sku: product.sku, barcode: product.barcode, name: product.name, reason: "exact official SKU not found" });
      continue;
    }
    matched.push({ product, official });
  }

  if (options.dryRun) {
    return {
      brand: "Деревенские Лакомства",
      targets: targets.length,
      matched: matched.length,
      unmatched,
      sourceFailures: source.failures,
      sourceSelected: source.selected,
      dryRun: true,
      samples: matched.slice(0, 10).map(({ product, official }) => ({
        sku: product.sku,
        local: product.name,
        official: official.title,
        species: official.species,
      })),
    };
  }

  const syncedAt = new Date().toISOString();
  for (const { product, official } of matched) {
    const name = product.site_name || ("Деревенские Лакомства — " + official.title);
    const description = product.site_description || composeDerlakDescription({
      title: official.title,
      sourceDescription: official.description,
      species: official.species,
    });
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
    brand: "Деревенские Лакомства",
    targets: targets.length,
    matched: matched.length,
    unmatched,
    sourceFailures: source.failures,
    updated: matched.length,
    contentSyncedAt: syncedAt,
  };
}

if (process.argv[1]?.endsWith("enrich-derlak-directus.mjs")) {
  console.log(JSON.stringify(await enrichDerlak({
    dryRun: process.argv.includes("--dry-run"),
  }), null, 2));
}
