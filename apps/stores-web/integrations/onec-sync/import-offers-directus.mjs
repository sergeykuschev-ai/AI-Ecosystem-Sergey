import { parseOffersCommerceMlFile } from "./parse-offers.mjs";

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

async function productIndex(config) {
  const response = await request(
    config, "GET", "/items/miska_catalog_products?fields=id,external_id&limit=-1",
  );
  return new Map((response?.data ?? []).map((item) => [item.external_id, item.id]));
}
export async function importOffers(offersPath) {
  const parsed = await parseOffersCommerceMlFile(offersPath);
  const config = requireConfig();
  const index = await productIndex(config);
  const missing = parsed.offers.filter((offer) => !index.has(offer.externalId));
  if (missing.length) {
    throw new Error(`${missing.length} offers have no staged product; import catalog first. First: ${missing[0].externalId}`);
  }

  const syncedAt = new Date().toISOString();
  let priced = 0;
  let inStock = 0;
  let clampedNegativeStock = 0;
  for (const offer of parsed.offers) {
    if (offer.price !== null) priced++;
    if (offer.stockQuantity > 0) inStock++;
    if (offer.rawStockQuantity < 0) clampedNegativeStock++;
    await request(config, "PATCH", `/items/miska_catalog_products/${index.get(offer.externalId)}`, {
      price: offer.price,
      stock_quantity: offer.stockQuantity,
      stock_quantity_raw: offer.rawStockQuantity,
      offers_synced_at: syncedAt,
      active: false,
    });
  }
  return {
    offers: parsed.offers.length,
    priced,
    withoutPrice: parsed.offers.length - priced,
    inStock,
    clampedNegativeStock,
    active: false,
    priceTypeId: parsed.priceTypeId,
    warehouseId: parsed.warehouseId,
  };
}

if (process.argv[1]?.endsWith("import-offers-directus.mjs")) {
  const offersPath = process.argv[2];
  if (!offersPath) throw new Error("usage: node import-offers-directus.mjs offers.xml");
  console.log(JSON.stringify(await importOffers(offersPath)));
}
