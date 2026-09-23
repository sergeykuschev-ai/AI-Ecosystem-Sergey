import test from "node:test";
import assert from "node:assert/strict";
import { parseEkopromBrandPage } from "./ekoprom-source.mjs";

test("parses Ekoprom static product cards with exact sku and barcode", () => {
  const html = `
    <div class=product><a href="/brands/neoterica/unitabs/unitabs-total/">
      <div class=title><div class=padder> Витамины Unitabs Total, 20 мл </div></div>
      <div class=image><img src="/site/assets/files/100/200x/u313.jpg"></div></a>
      <div class=code> U313 </div>
      <div class=introtext> Витаминный комплекс для кошек </div>
      <div class=properties> Состав: витамины и минералы. Кол-во в упаковке: 6 шт. Штрихкод: 4607092079554 </div>
    </div>`;
  const [product] = parseEkopromBrandPage(html, "https://ekoprom.org/brands/neoterica/unitabs/");
  assert.equal(product.sku, "U313");
  assert.equal(product.barcode, "4607092079554");
  assert.equal(product.imageUrl, "https://ekoprom.org/site/assets/files/100/u313.jpg");
  assert.match(product.description, /Витаминный комплекс/);
  assert.match(product.description, /Состав:/);
});
