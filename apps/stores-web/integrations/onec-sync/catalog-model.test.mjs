import test from "node:test";
import assert from "node:assert/strict";
import { parseCommerceMl } from "./parse-commerceml.mjs";
import { buildCatalogModel } from "./catalog-model.mjs";

test("builds category hierarchy and assigns products", () => {
  const xml = `<КоммерческаяИнформация><Группы><Группа><Ид>root</Ид><Наименование>Кошки</Наименование><Группы><Группа><Ид>food</Ид><Наименование>Корм</Наименование></Группа></Группы></Группа></Группы><Товары><Товар><Ид>p1</Ид><Наименование>AWARD</Наименование><Группы><Ид>food</Ид></Группы></Товар></Товары></КоммерческаяИнформация>`;
  const model = buildCatalogModel(xml, parseCommerceMl(xml));
  assert.equal(model.categories.find((x) => x.externalId === "food").parentExternalId, "root");
  assert.equal(model.products[0].categoryExternalId, "food");
});
