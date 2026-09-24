import test from "node:test";
import assert from "node:assert/strict";
import { parseAstraFarmProductPage } from "./astrafarm-source.mjs";

test("parses AstraFarm product page by exact GTIN", () => {
  const html = `
    <meta name="description" content="КонтрСекс Neo капли для котов и кобелей – препарат для регуляции половой охоты.">
    <meta property="og:image" content="https://astrafarm.com/upload/product.webp">
    <h1>КонтрСекс Neo капли для котов и кобелей</h1>
    <div>GTIN: 4607086630143</div>
  `;
  assert.deepEqual(parseAstraFarmProductPage(html, "https://astrafarm.test/item"), {
    title: "КонтрСекс Neo капли для котов и кобелей",
    gtin: "4607086630143",
    description: "КонтрСекс Neo капли для котов и кобелей – препарат для регуляции половой охоты.",
    imageUrl: "https://astrafarm.com/upload/product.webp",
    sourceUrl: "https://astrafarm.test/item",
  });
});

test("rejects incomplete AstraFarm page", () => {
  assert.throws(() => parseAstraFarmProductPage("<h1>x</h1>", "https://astrafarm.test/bad"), /incomplete AstraFarm product page/);
});
