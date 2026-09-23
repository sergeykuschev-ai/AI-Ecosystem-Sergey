import { readFile } from "node:fs/promises";
import { classifyCatalog } from "./normalize-catalog.mjs";

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
  const response = await request(config, "GET", "/items/miska_catalog_products?fields=id,external_id&limit=-1");
  return new Map((response?.data ?? []).map((item) => [item.external_id, item.id]));
}
export async function classifySnapshot(snapshotPath) {
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  if (!Array.isArray(snapshot.categories) || !Array.isArray(snapshot.products)) {
    throw new Error("catalog snapshot must contain categories and products arrays");
  }

  const rows = classifyCatalog(snapshot);
  const config = requireConfig();
  const index = await productIndex(config);
  const missing = rows.filter((row) => !index.has(row.externalId));
  if (missing.length) throw new Error(`${missing.length} classified products are missing in Directus`);

  const syncedAt = new Date().toISOString();
  let automatic = 0;
  let review = 0;
  let branded = 0;

  for (const row of rows) {
    if (row.classificationStatus === "auto") automatic++;
    else review++;
    if (row.brand) branded++;
    await request(config, "PATCH", `/items/miska_catalog_products/${index.get(row.externalId)}`, {
      site_section: row.siteSection,
      site_category: row.siteCategory,
      site_subcategory: row.siteSubcategory,
      brand: row.brand,
      classification_status: row.classificationStatus,
      classification_confidence: row.classificationConfidence,
      classification_reason: row.classificationReason,
      classification_synced_at: syncedAt,
    });
  }
  return {
    products: rows.length,
    automatic,
    review,
    branded,
    classificationSyncedAt: syncedAt,
  };
}

if (process.argv[1]?.endsWith("classify-directus.mjs")) {
  const snapshotPath = process.argv[2];
  if (!snapshotPath) throw new Error("usage: node classify-directus.mjs catalog.json");
  console.log(JSON.stringify(await classifySnapshot(snapshotPath)));
}
