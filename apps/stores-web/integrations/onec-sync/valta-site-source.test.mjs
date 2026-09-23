import test from "node:test";
import assert from "node:assert/strict";
import { parseValtaProductPage, parseSitemap } from "./valta-site-source.mjs";

test("parses Valta product page fields", () => {
  const html = `
    <h1>FIORY корм для крыс Ratty 850 г</h1>
    <meta itemprop="sku" content="06508" />
    <div class="detail-slider__inner">
      <a href="https://valta-s3-bitrix-upload.storage.yandexcloud.net/iblock/x/photo.jpg"><img></a>
    </div>
    <div class="b-tabs__item active" data-tab-body="1">
      FIORY смесь для крыс. Сбалансированное питание.
      <a>Читать полностью</a><span>Скрыть</span>
    </div>
    <div class="b-tabs__item" data-tab-body="3">
      <span itemprop="name">Бренд</span><span itemprop="value"><a>Fiory</a></span>
      <span itemprop="name">Штрих-код</span><div><div itemprop="value">8015975001312</div></div>
    </div>
  `;
  const result = parseValtaProductPage(html, "https://valta.ru/item");
  assert.equal(result.title, "FIORY корм для крыс Ratty 850 г");
  assert.equal(result.sku, "06508");
  assert.equal(result.brand, "Fiory");
  assert.equal(result.imageUrl, "https://valta-s3-bitrix-upload.storage.yandexcloud.net/iblock/x/photo.jpg");
  assert.deepEqual(result.barcodes, ["8015975001312"]);
  assert.match(result.description, /FIORY смесь/);
});

test("parses sitemap", () => {
  assert.deepEqual(parseSitemap("<urlset><url><loc>https://a</loc></url><url><loc>https://b</loc></url></urlset>"), ["https://a", "https://b"]);
});
