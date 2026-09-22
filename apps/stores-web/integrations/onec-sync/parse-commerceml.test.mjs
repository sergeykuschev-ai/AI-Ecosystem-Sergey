import test from "node:test";
import assert from "node:assert/strict";
import { parseCommerceMl } from "./parse-commerceml.mjs";

test("parses CommerceML group and product", () => {
  const xml = `<КоммерческаяИнформация><Группы><Группа><Ид>g1</Ид><Наименование>Кошки &amp; коты</Наименование></Группа></Группы><Товары><Товар><Ид>p1</Ид><Артикул>A1</Артикул><Наименование>Корм</Наименование><Группы><Ид>g1</Ид></Группы></Товар></Товары></КоммерческаяИнформация>`;
  const parsed = parseCommerceMl(xml);
  assert.equal(parsed.groups[0].name, "Кошки & коты");
  assert.equal(parsed.products[0].externalId, "p1");
  assert.deepEqual(parsed.products[0].groupIds, ["g1"]);
});
