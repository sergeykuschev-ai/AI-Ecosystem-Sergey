import test from "node:test";
import assert from "node:assert/strict";
import { parseDerlakProductPage, parseSitemap } from "./derlak-source.mjs";

test("parses Derlak product page", () => {
  const html = `
    <div class="main-photo"><img src="/upload/item.png" alt="Ломтики"></div>
    <div class="product-info">
      <h1 class="product-title">Ломтики крольчатины</h1>
      <div class="product-artnumber">Артикул: 79711670</div>
      <p class="lead">Лакомство. <b>Состав:</b> мясо кролика, минералы.</p>
    </div>
  `;
  const product = parseDerlakProductPage(html, "https://derlak.ru/catalog/dogs/treats/x-art-79711670/");
  assert.equal(product.sku, "79711670");
  assert.equal(product.title, "Ломтики крольчатины");
  assert.equal(product.imageUrl, "https://derlak.ru/upload/item.png");
  assert.equal(product.species, "Собаки");
  assert.match(product.description, /мясо кролика/);
});

test("parses sitemap urls", () => {
  assert.deepEqual(parseSitemap("<urlset><url><loc>https://a</loc></url><url><loc>https://b</loc></url></urlset>"), ["https://a", "https://b"]);
});
