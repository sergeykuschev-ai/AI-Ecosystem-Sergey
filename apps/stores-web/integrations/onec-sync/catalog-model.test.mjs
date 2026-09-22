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

test("assigns unique slugs to categories with equal names", () => {
  const xml = `<КоммерческаяИнформация><Группы><Группа><Ид>g1</Ид><Наименование>Корм</Наименование></Группа><Группа><Ид>g2</Ид><Наименование>Корм</Наименование></Группа></Группы></КоммерческаяИнформация>`;
  const model = buildCatalogModel(xml, parseCommerceMl(xml));
  const slugs = model.categories.map((category) => category.slug);
  assert.equal(slugs[0], "корм");
  assert.equal(slugs[1], "корм-2");
  assert.equal(new Set(slugs).size, slugs.length);
});

test("assigns null category to products referencing unknown groups", () => {
  const xml = `<КоммерческаяИнформация><Группы><Группа><Ид>g1</Ид><Наименование>Кошки</Наименование></Группа></Группы><Товары><Товар><Ид>p1</Ид><Наименование>Корм</Наименование><Группы><Ид>missing</Ид></Группы></Товар><Товар><Ид>p2</Ид><Наименование>Лежанка</Наименование></Товар></Товары></КоммерческаяИнформация>`;
  const model = buildCatalogModel(xml, parseCommerceMl(xml));
  assert.equal(model.products.find((x) => x.externalId === "p1").categoryExternalId, null);
  assert.equal(model.products.find((x) => x.externalId === "p2").categoryExternalId, null);
});

test("builds hierarchy for groups that carry attributes", () => {
  const xml = `<КоммерческаяИнформация><Группы><Группа Код="r"><Ид>root</Ид><Наименование>Кошки</Наименование><Группы><Группа Код="c"><Ид>food</Ид><Наименование>Корм</Наименование></Группа></Группы></Группа></Группы><Товары><Товар><Ид>p1</Ид><Наименование>AWARD</Наименование><Группы><Ид>food</Ид></Группы></Товар></Товары></КоммерческаяИнформация>`;
  const model = buildCatalogModel(xml, parseCommerceMl(xml));
  assert.equal(model.categories.find((x) => x.externalId === "food").parentExternalId, "root");
  assert.equal(model.products[0].categoryExternalId, "food");
});
