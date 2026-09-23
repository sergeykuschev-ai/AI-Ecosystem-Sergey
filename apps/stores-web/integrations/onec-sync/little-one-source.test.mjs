import test from "node:test";
import assert from "node:assert/strict";
import { parseLittleOneCatalog, parseLittleOneProductPage } from "./little-one-source.mjs";

test("parses catalog variant without confusing hover class with a new card", () => {
  const html = `
    <div class="col-lg-4 card-list-item">
      <a href="/catalog/little-one-korm/" class="card-list-name">Little One Корм</a>
      <div class="card-list-item-hover">
        <ul><li><div class="text">400 г</div><div class="value">АРТ. 31020</div></li></ul>
      </div>
    </div>
  `;
  const result = parseLittleOneCatalog(html);
  assert.equal(result.size, 1);
  assert.deepEqual(result.get("31020"), {
    sku: "31020",
    packaging: "400 г",
    familyTitle: "Little One Корм",
    sourceUrl: "https://www.mealberry.ru/catalog/little-one-korm/",
  });
});

test("selects exact variant image by SKU when EAN is not in filename", () => {
  const html = `
    <h1>Воздушные зерна Little One</h1>
    <div class="js-product-pictures">
      <img src="/upload/generic.png">
      <img src="/upload/32031_pack.jpg">
    </div>
    <div class="product-catalog-info-wrap"></div>
    <div class="product-catalog__description"><div class="text">Лакомство для грызунов</div></div>
    <ul class="packing-info"><li>70 г АРТ. 32031 EAN 4260559181735</li></ul>
  `;
  const result = parseLittleOneProductPage(html, {
    sku: "32031",
    packaging: "70 г",
    familyTitle: "Воздушные зерна Little One",
    sourceUrl: "https://www.mealberry.ru/catalog/item/",
  });
  assert.equal(result.ean, "4260559181735");
  assert.equal(result.imageUrl, "https://www.mealberry.ru/upload/32031_pack.jpg");
});
