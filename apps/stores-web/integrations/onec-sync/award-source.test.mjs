import test from "node:test";
import assert from "node:assert/strict";
import { parseAwardProductPage, parseSitemap } from "./award-source.mjs";

test("parses official AWARD Product microdata", () => {
  const html = `
    <div class="schema-org-block" itemscope itemtype="https://schema.org/Product">
      <link href="https://cdn.example/p.jpg" itemprop="image">
      <meta content="Описание &amp; детали" itemprop="description">
      <meta content="AWARD Product 2 кг" itemprop="name">
      <meta content="7175819" itemprop="sku">
    </div>`;
  assert.deepEqual(parseAwardProductPage(html, "https://award.test/product/x"), {
    sku: "7175819",
    title: "AWARD Product 2 кг",
    description: "Описание & детали",
    imageUrl: "https://cdn.example/p.jpg",
    sourceUrl: "https://award.test/product/x",
  });
});

test("parses sitemap product URLs", () => {
  assert.deepEqual(
    parseSitemap("<urlset><url><loc>https://a.test/1</loc></url><url><loc>https://a.test/2</loc></url></urlset>"),
    ["https://a.test/1", "https://a.test/2"],
  );
});

test("rejects incomplete product microdata", () => {
  assert.throws(
    () => parseAwardProductPage('<div itemtype="https://schema.org/Product"></div>', "https://award.test/bad"),
    /incomplete Product microdata/,
  );
});
