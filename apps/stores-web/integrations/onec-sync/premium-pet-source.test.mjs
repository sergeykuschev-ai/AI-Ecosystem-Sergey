import test from "node:test";
import assert from "node:assert/strict";
import { parsePremiumPetProductPage } from "./premium-pet-source.mjs";

test("parses Premium Pet exact article, barcode, image and description", () => {
  const html = `
    <meta itemprop="name" content="Функциональный влажный корм Момент счастья">
    <meta itemprop="description" content="Корм с тунцом и таурином.">
    <meta property="og:image" content="https://premium-pet.test/product.png">
    <div class="article"><span class="block_title" itemprop="name">Артикул:</span><span class="value" itemprop="value">Z1732</span></div>
    <table><tr><td><span itemprop="name">Штрихкод</span></td><td><span itemprop="value">6941333417322</span></td></tr></table>
  `;
  assert.deepEqual(parsePremiumPetProductPage(html,"https://premium-pet.test/item"),{
    title:"Функциональный влажный корм Момент счастья",
    sku:"Z1732",
    barcode:"6941333417322",
    description:"Корм с тунцом и таурином.",
    imageUrl:"https://premium-pet.test/product.png",
    sourceUrl:"https://premium-pet.test/item",
  });
});
test("rejects page without exact barcode",()=>assert.throws(
  ()=>parsePremiumPetProductPage('<meta itemprop="name" content="x"><meta property="og:image" content="https://x.test/a.jpg">',"https://x.test"),
  /incomplete Premium Pet product page/
));
