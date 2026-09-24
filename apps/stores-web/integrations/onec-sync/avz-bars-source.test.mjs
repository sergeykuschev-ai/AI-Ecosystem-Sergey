import test from "node:test";
import assert from "node:assert/strict";
import { parseAvzBarsProductPage } from "./avz-bars-source.mjs";

test("parses AVZ Bars product page with exact variant and image", () => {
  const html = `
    <meta name="description" content="Барс спрей для собак 200 мл.">
    <h1>Барс спрей инсектоакарицидный для собак 200 мл</h1>
    <div class="product-pic"><div class="pic"><div class="slide">
      <a href="/upload/iblock/x/product.jpg" class="fancybox"><img src="/upload/x.webp"></a>
    </div></div></div><div class="pic-thumbs"></div>
    <div>Форма выпуска 200 мл</div>
  `;
  assert.deepEqual(parseAvzBarsProductPage(html, "https://avzvet.ru/product/test/200-ml/", "200 мл"), {
    title: "Барс спрей инсектоакарицидный для собак 200 мл",
    description: "Барс спрей для собак 200 мл.",
    imageUrl: "https://avzvet.ru/upload/iblock/x/product.jpg",
    sourceUrl: "https://avzvet.ru/product/test/200-ml/",
    expectedVariant: "200 мл",
  });
});

test("rejects wrong AVZ variant", () => {
  const html = '<meta name="description" content="x"><h1>Барс 100 мл</h1><div class="product-pic"><a href="/x.jpg" class="fancybox"></a></div><div class="pic-thumbs"></div>';
  assert.throws(() => parseAvzBarsProductPage(html, "https://avzvet.ru/x", "200 мл"), /expected variant not found/);
});
