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

test("returns empty result for empty or groupless input", () => {
  assert.deepEqual(parseCommerceMl(""), { groups: [], products: [] });
  assert.deepEqual(parseCommerceMl("<КоммерческаяИнформация></КоммерческаяИнформация>"), {
    groups: [],
    products: [],
  });
});

test("drops products missing id or name", () => {
  const xml = `<КоммерческаяИнформация><Товары><Товар><Ид>p1</Ид></Товар><Товар><Наименование>Без id</Наименование></Товар><Товар><Ид>p2</Ид><Наименование>Корм</Наименование></Товар></Товары></КоммерческаяИнформация>`;
  const parsed = parseCommerceMl(xml);
  assert.equal(parsed.products.length, 1);
  assert.equal(parsed.products[0].externalId, "p2");
});

test("decodes entities and reads full description text", () => {
  const xml = `<КоммерческаяИнформация><Товары><Товар><Ид>p1</Ид><Наименование>Корм &quot;Premium&quot;</Наименование><Описание>Состав: мясо &amp; рыба &lt; 80%</Описание></Товар></Товары></КоммерческаяИнформация>`;
  const parsed = parseCommerceMl(xml);
  assert.equal(parsed.products[0].name, 'Корм "Premium"');
  assert.equal(parsed.products[0].description, "Состав: мясо & рыба < 80%");
});

test("parses groups that carry attributes", () => {
  const xml = `<КоммерческаяИнформация><Группы><Группа Код="cat-1"><Ид>g1</Ид><Наименование>Кошки</Наименование></Группа></Группы></КоммерческаяИнформация>`;
  const parsed = parseCommerceMl(xml);
  assert.deepEqual(parsed.groups, [{ externalId: "g1", name: "Кошки" }]);
});
