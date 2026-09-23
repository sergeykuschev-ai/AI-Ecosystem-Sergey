import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importOffers } from "./import-offers-directus.mjs";
import { MISKA_PRICE_TYPE_ID, MISKA_WAREHOUSE_ID } from "./parse-offers.mjs";

function xml(id = "p1", price = "306", stock = "2") {
  return `<КоммерческаяИнформация><ПакетПредложений><Предложения><Предложение>
  <Ид>${id}</Ид><Цены><Цена><ИдТипаЦены>${MISKA_PRICE_TYPE_ID}</ИдТипаЦены>
  <ЦенаЗаЕдиницу>${price}</ЦенаЗаЕдиницу></Цена></Цены>
  <Склад ИдСклада="${MISKA_WAREHOUSE_ID}" КоличествоНаСкладе="${stock}"/>
  </Предложение></Предложения></ПакетПредложений></КоммерческаяИнформация>`;
}

async function writeXml(content) {
  const dir = await mkdtemp(join(tmpdir(), "miska-offers-"));
  const path = join(dir, "offers.xml");
  await writeFile(path, content, "utf8");
  return path;
}
function stubDirectus(items) {
  const calls = [];
  mock.method(globalThis, "fetch", async (url, options = {}) => {
    const method = options.method ?? "GET";
    calls.push({ method, url: String(url), body: options.body ? JSON.parse(options.body) : null });
    if (method === "GET") return { ok: true, status: 200, json: async () => ({ data: items }) };
    return { ok: true, status: 200, json: async () => ({ data: {} }) };
  });
  return calls;
}

test("patches staged product with Miska price and stock and keeps it inactive", async (t) => {
  t.after(() => mock.restoreAll());
  process.env.DIRECTUS_URL = "http://directus.test";
  process.env.DIRECTUS_ADMIN_TOKEN = "token";
  const calls = stubDirectus([{ id: "uuid-1", external_id: "p1" }]);
  const result = await importOffers(await writeXml(xml()));
  const patch = calls.find((call) => call.method === "PATCH");
  assert.equal(patch.body.price, 306);
  assert.equal(patch.body.stock_quantity, 2);
  assert.equal(patch.body.stock_quantity_raw, 2);
  assert.equal(patch.body.active, false);
  assert.equal(result.priced, 1);
});
test("clamps negative public stock and stores raw diagnostic value", async (t) => {
  t.after(() => mock.restoreAll());
  process.env.DIRECTUS_URL = "http://directus.test";
  process.env.DIRECTUS_ADMIN_TOKEN = "token";
  const calls = stubDirectus([{ id: "uuid-1", external_id: "p1" }]);
  const result = await importOffers(await writeXml(xml("p1", "306", "-3")));
  const patch = calls.find((call) => call.method === "PATCH");
  assert.equal(patch.body.stock_quantity, 0);
  assert.equal(patch.body.stock_quantity_raw, -3);
  assert.equal(result.clampedNegativeStock, 1);
});

test("fails before patching when a staged product is missing", async (t) => {
  t.after(() => mock.restoreAll());
  process.env.DIRECTUS_URL = "http://directus.test";
  process.env.DIRECTUS_ADMIN_TOKEN = "token";
  const calls = stubDirectus([]);
  await assert.rejects(importOffers(await writeXml(xml())), /import catalog first/);
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 0);
});
