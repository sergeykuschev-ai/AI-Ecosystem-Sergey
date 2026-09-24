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


test("detects explicit accessory and care brands from product names", () => {
  assert.equal(classifyProduct({ externalId: "x1", name: "Petstages игрушка Dental Вишни", categoryExternalId: null }, []).brand, "Petstages");
  assert.equal(classifyProduct({ externalId: "x2", name: "RedDingo Поводок светоотражающий", categoryExternalId: null }, []).brand, "Red Dingo");
  assert.equal(classifyProduct({ externalId: "x3", name: "Imac Поилка Tweety 200мл", categoryExternalId: null }, []).brand, "IMAC");
  assert.equal(classifyProduct({ externalId: "x4", name: "Фармавит NEO Витамины 60таб", categoryExternalId: null }, []).brand, "Фармавит NEO");
  assert.equal(classifyProduct({ externalId: "x5", name: "Антибактериальный шампунь CO PET, 300 мл", categoryExternalId: null }, []).brand, "CO PET");
});

test("detects additional explicit brands from product names", () => {
  const samples = [
    ["PetActive Relax", "PetActive"],
    ["Good Neem Биокапли", "Good Neem"],
    ["Green Fort Neo Биокапли", "Green Fort Neo"],
    ["КонтрСекс NEO Капли", "КонтрСекс NEO"],
    ["Бриллиантовые Глаза Капли", "Бриллиантовые Глаза"],
    ["DoggyMan салфетки", "DoggyMan"],
    ["FURminator M", "FURminator"],
    ["Bio-Groom Shampoo", "Bio-Groom"],
    ["V.I.Pet Адресник", "V.I.Pet"],
    ["Fitodoc Рыбий жир", "Fitodoc"],
    ["Dog Luck спрей", "Dog Luck"],
    ["Пижон Дождевик", "Пижон"],
    ["РедПластик Гамак", "РедПластик"],
    ["Good Dog&Cat Спрей", "Good Dog&Cat"],
    ["Апиценна паспорт", "Апиценна"],
    ["Альпийские луга Травка", "Альпийские луга"],
    ["Лактобифид комплекс", "Лактобифид"],
    ["Ветом 1 пробиотик", "Ветом"],
    ["салфетки Кемаль", "Кемаль"],
  ];
  for (const [name, brand] of samples) {
    assert.equal(classifyProduct({ externalId: "x", name, categoryExternalId: null }, []).brand, brand);
  }
});
