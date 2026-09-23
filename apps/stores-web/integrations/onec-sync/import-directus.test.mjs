import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock } from "node:test";
import { importSnapshot } from "./import-directus.mjs";

const SNAPSHOT = {
  schemaVersion: 1,
  generatedAt: "2026-09-22T00:00:00.000Z",
  source: { format: "CommerceML 2.07" },
  counts: { categories: 1, products: 1 },
  categories: [
    { externalId: "g1", parentExternalId: null, name: "Кошки", slug: "koshki", sortOrder: 0 },
  ],
  products: [
    {
      externalId: "p1", sku: "A1", barcode: "4600000000017", name: "Корм",
      unit: "шт", categoryExternalId: "g1", description: "Корм для кошек",
    },
  ],
};

async function writeSnapshot(dir, data) {
  const path = join(dir, "catalog.json");
  await writeFile(path, JSON.stringify(data), "utf8");
  return path;
}

function stubDirectus(existingIds = new Set()) {
  const calls = [];
  mock.method(globalThis, "fetch", async (url, options = {}) => {
    const method = options.method ?? "GET";
    calls.push({ method, url: String(url), body: options.body ? JSON.parse(options.body) : null });
    if (method === "GET") {
      const data = [...existingIds].map((id) => ({ id }));
      return { ok: true, status: 200, json: async () => ({ data }) };
    }
    return { ok: true, status: 200, json: async () => ({ data: {} }) };
  });
  return calls;
}

test("importSnapshot posts new categories and products with active false", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "miska-import-"));
  const calls = stubDirectus();
  t.after(() => mock.restoreAll());
  process.env.DIRECTUS_URL = "http://directus.test/";
  process.env.DIRECTUS_ADMIN_TOKEN = "token";

  const result = await importSnapshot(await writeSnapshot(dir, SNAPSHOT));

  assert.deepEqual(result, { categories: 1, products: 1, active: false });
  const posts = calls.filter((call) => call.method === "POST");
  assert.equal(posts.length, 2);
  const categoryPost = posts.find((call) => call.url.includes("/items/miska_catalog_categories"));
  assert.equal(categoryPost.body.external_id, "g1");
  assert.equal(categoryPost.body.active, false);
  assert.equal(categoryPost.body.slug, "koshki");
  const productPost = posts.find((call) => call.url.includes("/items/miska_catalog_products"));
  assert.equal(productPost.body.external_id, "p1");
  assert.equal(productPost.body.category_external_id, "g1");
  assert.equal(productPost.body.description, undefined);
  assert.equal(productPost.body.active, false);
  assert.match(categoryPost.url, /^http:\/\/directus\.test\/items\//);
});

test("importSnapshot patches existing items by external_id", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "miska-import-"));
  const calls = stubDirectus(new Set(["uuid-1", "uuid-2"]));
  t.after(() => mock.restoreAll());
  process.env.DIRECTUS_URL = "http://directus.test/";
  process.env.DIRECTUS_ADMIN_TOKEN = "token";

  await importSnapshot(await writeSnapshot(dir, SNAPSHOT));

  const patches = calls.filter((call) => call.method === "PATCH");
  assert.equal(patches.length, 2);
  assert.ok(patches.every((call) => /\/items\/miska_catalog_(categories|products)\/uuid-\d$/.test(call.url)));
});

test("importSnapshot rejects snapshots with an unsupported schemaVersion", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "miska-import-"));
  t.after(() => mock.restoreAll());
  stubDirectus();
  process.env.DIRECTUS_URL = "http://directus.test/";
  process.env.DIRECTUS_ADMIN_TOKEN = "token";

  const path = await writeSnapshot(dir, { ...SNAPSHOT, schemaVersion: 2 });
  await assert.rejects(importSnapshot(path), /unsupported schemaVersion 2/);
});

test("importSnapshot rejects snapshots with missing arrays", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "miska-import-"));
  t.after(() => mock.restoreAll());
  stubDirectus();
  process.env.DIRECTUS_URL = "http://directus.test/";
  process.env.DIRECTUS_ADMIN_TOKEN = "token";

  const path = await writeSnapshot(dir, { schemaVersion: 1, categories: null, products: null });
  await assert.rejects(importSnapshot(path), /categories and products must be arrays/);
});

test("importSnapshot requires Directus configuration", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "miska-import-"));
  t.after(() => mock.restoreAll());
  stubDirectus();
  const originalUrl = process.env.DIRECTUS_URL;
  const originalToken = process.env.DIRECTUS_ADMIN_TOKEN;
  delete process.env.DIRECTUS_URL;
  delete process.env.DIRECTUS_ADMIN_TOKEN;
  t.after(() => {
    if (originalUrl === undefined) delete process.env.DIRECTUS_URL; else process.env.DIRECTUS_URL = originalUrl;
    if (originalToken === undefined) delete process.env.DIRECTUS_ADMIN_TOKEN; else process.env.DIRECTUS_ADMIN_TOKEN = originalToken;
  });

  const path = await writeSnapshot(dir, SNAPSHOT);
  await assert.rejects(importSnapshot(path), /DIRECTUS_URL and DIRECTUS_ADMIN_TOKEN are required/);
});
