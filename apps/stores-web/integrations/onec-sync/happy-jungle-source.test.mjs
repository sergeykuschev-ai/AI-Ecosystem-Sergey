import test from "node:test";
import assert from "node:assert/strict";
import { parseHappyJungleBrandPage } from "./happy-jungle-source.mjs";

test("parses official Happy Jungle product cards", () => {
  const html = `
    <div class=product><a href="/brands/ekoprom/happy-jungle/korm-dlia-volnistykh-popugaev-500-g/">
      <div class=title><div class=padder> Корм для волнистых попугаев, 500 г </div></div>
      <div class=image><img src="/site/assets/files/1532/200x/j102.jpg"></div></a>
      <div class=code> J102 </div>
      <div class=introtext> Обеспечит птицу всеми необходимыми питательными веществами </div>
      <div class=properties> Состав: семена, фрукты, минералы, мед. Кол-во в упаковке: 14 шт. Штрихкод: 4607092076027 </div>
    </div>`;
  const [product] = parseHappyJungleBrandPage(html);
  assert.equal(product.sku, "J102");
  assert.equal(product.barcode, "4607092076027");
  assert.match(product.title, /волнистых попугаев/);
  assert.equal(product.imageUrl, "https://ekoprom.org/site/assets/files/1532/j102.jpg");
  assert.match(product.description, /Состав:/);
});
