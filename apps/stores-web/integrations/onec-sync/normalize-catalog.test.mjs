import test from "node:test";
import assert from "node:assert/strict";
import { classifyProduct } from "./normalize-catalog.mjs";

function categories(path) {
  return path.map((name, index) => ({
    externalId: `g${index}`,
    parentExternalId: index ? `g${index - 1}` : null,
    name,
  }));
}

function classify(name, path) {
  const cats = categories(["МИСКА ЗООТОВАРЫ", ...path]);
  return classifyProduct({ externalId: "p1", name, categoryExternalId: cats.at(-1).externalId }, cats);
}

test("keeps source animal section and food category", () => {
  const result = classify("Сухой корм AWARD", ["Собаки", "Корм для собак", "Сухой корм", "AWARD сухой для собак"]);
  assert.equal(result.siteSection, "Собаки");
  assert.equal(result.siteCategory, "Сухой корм");
  assert.equal(result.brand, "AWARD");
  assert.equal(result.classificationStatus, "auto");
});

test("normalizes pharmacy products", () => {
  const result = classify("Inspector Quadro Капли противопаразитарные д/кош 4-8кг", ["Аптека"]);
  assert.equal(result.siteSection, "Ветаптека");
  assert.equal(result.siteCategory, "Противопаразитарные средства");
  assert.equal(result.brand, "Inspector");
});

test("moves miscellaneous dog apparel by product name", () => {
  const result = classify("Yoriki Дождевик Мохито д/девочек р.L", ["Одежда"]);
  assert.equal(result.siteSection, "Собаки");
  assert.equal(result.siteCategory, "Одежда и обувь");
  assert.equal(result.brand, "Yoriki");
});

test("maps Chinese leash to dog ammunition", () => {
  const result = classify("Поводок зеленый с красным 5 м", ["Китай", "Китай"]);
  assert.equal(result.siteSection, "Собаки");
  assert.equal(result.siteCategory, "Амуниция");
});

test("ambiguous unrecognized item stays in review", () => {
  const result = classify("дал", ["23250"]);
  assert.equal(result.classificationStatus, "review");
  assert.equal(result.siteCategory, "Прочее");
});

test("detects a Cyrillic brand after a generic product word", () => {
  const result = classify("Лакомство Мнямс для собак кроличьи уши", ["Собаки", "Корм для собак", "Лакомства"]);
  assert.equal(result.brand, "Мнямс");
});
