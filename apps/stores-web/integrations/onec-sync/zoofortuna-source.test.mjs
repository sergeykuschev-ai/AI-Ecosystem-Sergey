import test from "node:test";
import assert from "node:assert/strict";
import { parseZooFortunaProductPage } from "./zoofortuna-source.mjs";

test("parses ZooFortuna product page with real image", () => {
  const html = `
    <div class="woocommerce-product-gallery__wrapper">
      <div><img src="https://zoo-fortyna.ru/wp-content/uploads/item.jpg" class="wp-post-image"></div>
    </div>
    <h1 class="product_title entry-title">Комбинезон на флисе МОПС кобель (31 см)</h1>
    <div class="woocommerce-product-details__short-description"><p>РАЗМЕР: длина спины 31 см.</p></div>
    <span class="sku_wrapper">Артикул: <span class="sku">567731</span></span>
  `;
  const product = parseZooFortunaProductPage(html, "https://zoo-fortyna.ru/product/x/");
  assert.equal(product.sku, "567731");
  assert.equal(product.title, "Комбинезон на флисе МОПС кобель (31 см)");
  assert.equal(product.imageUrl, "https://zoo-fortyna.ru/wp-content/uploads/item.jpg");
  assert.match(product.description, /длина спины 31 см/);
});

test("ignores placeholder image", () => {
  const html = `
    <div class="woocommerce-product-gallery__wrapper">
      <div><img src="https://zoo-fortyna.ru/wp-content/uploads/woocommerce-placeholder-600x600.png"></div>
    </div>
    <h1 class="product_title entry-title">Жилет</h1>
    <div class="woocommerce-product-details__short-description"><p>Описание</p></div>
    <span class="sku">п-061</span>
  `;
  const product = parseZooFortunaProductPage(html, "https://zoo-fortyna.ru/product/x/");
  assert.equal(product.imageUrl, "");
});
