import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifySnapshot } from "./classify-directus.mjs";

const SNAPSHOT = {
  categories: [
    { externalId: "root", parentExternalId: null, name: "МИСКА ЗООТОВАРЫ" },
    { externalId: "dogs", parentExternalId: "root", name: "Собаки" },
    { externalId: "food", parentExternalId: "dogs", name: "Корм для собак" },
    { externalId: "dry", parentExternalId: "food", name: "Сухой корм" },
    { externalId: "award", parentExternalId: "dry", name: "AWARD сухой для собак" },
  ],
  products: [{ externalId: "p1", name: "Сухой корм", categoryExternalId: "award" }],
};

async function snapshotFile(data = SNAPSHOT) {
  const dir = await mkdtemp(join(tmpdir(), "miska-classify-"));
  const path = join(dir, "catalog.json");
  await writeFile(path, JSON.stringify(data), "utf8");
  return path;
}
function stub(items) {
  const calls = [];
  mock.method(globalThis, "fetch", async (url, options = {}) => {
    const method = options.method ?? "GET";
    calls.push({ method, url: String(url), body: options.body ? JSON.parse(options.body) : null });
    if (method === "GET") return { ok: true, status: 200, json: async () => ({ data: items }) };
    return { ok: true, status: 200, json: async () => ({ data: {} }) };
  });
  return calls;
}

test("writes derived taxonomy without touching curated content", async (t) => {
  t.after(() => mock.restoreAll());
  process.env.DIRECTUS_URL = "http://directus.test";
  process.env.DIRECTUS_ADMIN_TOKEN = "token";
  const calls = stub([{ id: "uuid-1", external_id: "p1" }]);

  const result = await classifySnapshot(await snapshotFile());
  const patch = calls.find((call) => call.method === "PATCH");
  assert.equal(patch.body.site_section, "Собаки");
  assert.equal(patch.body.site_category, "Сухой корм");
  assert.equal(patch.body.brand, "AWARD");
  assert.equal(patch.body.classification_status, "auto");
  assert.equal(patch.body.site_name, undefined);
  assert.equal(patch.body.site_description, undefined);
  assert.equal(patch.body.site_image, undefined);
  assert.equal(patch.body.content_status, undefined);
  assert.equal(result.automatic, 1);
});
test("fails before patching when Directus catalog is incomplete", async (t) => {
  t.after(() => mock.restoreAll());
  process.env.DIRECTUS_URL = "http://directus.test";
  process.env.DIRECTUS_ADMIN_TOKEN = "token";
  const calls = stub([]);
  await assert.rejects(classifySnapshot(await snapshotFile()), /missing in Directus/);
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 0);
});
