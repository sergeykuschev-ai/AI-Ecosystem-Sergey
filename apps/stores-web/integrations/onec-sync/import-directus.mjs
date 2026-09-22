import { readFile } from "node:fs/promises";

const base = (process.env.DIRECTUS_URL || "").replace(/\/$/, "");
const token = process.env.DIRECTUS_ADMIN_TOKEN || "";
if (!base || !token) throw new Error("DIRECTUS_URL and DIRECTUS_ADMIN_TOKEN are required");

async function request(method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function upsert(collection, externalId, payload) {
  const query = new URLSearchParams({ "filter[external_id][_eq]": externalId, fields: "id", limit: "1" });
  const found = await request("GET", `/items/${collection}?${query}`);
  const id = found?.data?.[0]?.id;
  return id
    ? request("PATCH", `/items/${collection}/${id}`, payload)
    : request("POST", `/items/${collection}`, payload);
}

export async function importSnapshot(snapshotPath) {
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  const syncedAt = new Date().toISOString();
  let categories = 0;
  let products = 0;
  for (const item of snapshot.categories) {
    await upsert("miska_catalog_categories", item.externalId, {
      external_id: item.externalId, parent_external_id: item.parentExternalId,
      name: item.name, slug: item.slug, sort_order: item.sortOrder,
      active: false, synced_at: syncedAt,
    });
    categories++;
  }
  for (const item of snapshot.products) {
    await upsert("miska_catalog_products", item.externalId, {
      external_id: item.externalId, sku: item.sku || null, barcode: item.barcode || null,
      name: item.name, unit: item.unit || null, category_external_id: item.categoryExternalId,
      description: item.description || null, active: false, synced_at: syncedAt,
    });
    products++;
  }
  return { categories, products, active: false };
}

if (process.argv[1]?.endsWith("import-directus.mjs")) {
  const result = await importSnapshot(process.argv[2]);
  console.log(JSON.stringify(result));
}
