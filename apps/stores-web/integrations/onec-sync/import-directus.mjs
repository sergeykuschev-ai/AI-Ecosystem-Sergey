import { readFile } from "node:fs/promises";

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

async function upsert(config, collection, externalId, payload) {
  const query = new URLSearchParams({ "filter[external_id][_eq]": externalId, fields: "id", limit: "1" });
  const found = await request(config, "GET", `/items/${collection}?${query}`);
  const id = found?.data?.[0]?.id;
  return id
    ? request(config, "PATCH", `/items/${collection}/${id}`, payload)
    : request(config, "POST", `/items/${collection}`, payload);
}

function validateSnapshot(snapshot, snapshotPath) {
  const source = snapshotPath || "snapshot";
  if (snapshot === null || typeof snapshot !== "object") {
    throw new Error(`${source}: expected a JSON object`);
  }
  if (snapshot.schemaVersion !== 1) {
    throw new Error(`${source}: unsupported schemaVersion ${JSON.stringify(snapshot.schemaVersion)}, expected 1`);
  }
  if (!Array.isArray(snapshot.categories) || !Array.isArray(snapshot.products)) {
    throw new Error(`${source}: categories and products must be arrays`);
  }
}

export async function importSnapshot(snapshotPath) {
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  validateSnapshot(snapshot, snapshotPath);
  const config = requireConfig();
  const syncedAt = new Date().toISOString();
  let categories = 0;
  let products = 0;
  for (const item of snapshot.categories) {
    await upsert(config, "miska_catalog_categories", item.externalId, {
      external_id: item.externalId, parent_external_id: item.parentExternalId,
      name: item.name, slug: item.slug, sort_order: item.sortOrder,
      active: false, synced_at: syncedAt,
    });
    categories++;
  }
  for (const item of snapshot.products) {
    await upsert(config, "miska_catalog_products", item.externalId, {
      external_id: item.externalId, sku: item.sku || null, barcode: item.barcode || null,
      name: item.name, unit: item.unit || null, category_external_id: item.categoryExternalId,
      active: false, synced_at: syncedAt,
    });
    products++;
  }
  return { categories, products, active: false };
}

if (process.argv[1]?.endsWith("import-directus.mjs")) {
  const snapshotPath = process.argv[2];
  if (!snapshotPath) throw new Error("usage: node import-directus.mjs snapshot.json");
  const result = await importSnapshot(snapshotPath);
  console.log(JSON.stringify(result));
}
