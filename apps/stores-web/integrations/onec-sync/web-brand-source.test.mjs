import test from "node:test";
import assert from "node:assert/strict";
import { parseBrandPage, parseSitemap } from "./web-brand-source.mjs";

test("parses AlphaPet main product image and description", () => {
  const html = [
    "<html><head>",
    "<title>Корм AlphaPet WOW</title>",
    "<meta name=\"description\" content=\"Описание AlphaPet\">",
    "</head><body>",
    "<img class=\"main-img\" src=\"/upload/p.png\" title=\"AlphaPet WOW для кошек (1,5 кг)\" alt=\"x\">",
    "</body></html>",
  ].join("");
  assert.deepEqual(parseBrandPage("AlphaPet", html, "https://alphapet.ru/catalog/x/"), {
    brand: "AlphaPet",
    title: "AlphaPet WOW для кошек (1,5 кг)",
    pageTitle: "Корм AlphaPet WOW",
    description: "Описание AlphaPet",
    imageUrl: "https://alphapet.ru/upload/p.png",
    sourceUrl: "https://alphapet.ru/catalog/x/",
    matchText: "AlphaPet WOW для кошек (1,5 кг) Корм AlphaPet WOW Описание AlphaPet",
  });
});

test("parses Sirius feed page", () => {
  const html = [
    "<html><head><title>Sirius page</title>",
    "<meta property=\"og:title\" content=\"Кролик с морковью — Sirius\">",
    "<meta name=\"description\" content=\"Влажный корм Sirius 85 г для взрослых кошек\">",
    "</head><body><section class=\"feed-item\">",
    "<div class=\"item-feed-info__img\"><img src=\"/upload/a.jpg\" alt=\"\"></div>",
    "</section></body></html>",
  ].join("");
  const result = parseBrandPage("Sirius", html, "https://sirius-pet.ru/katalog/x/");
  assert.equal(result.title, "Кролик с морковью — Sirius");
  assert.equal(result.description, "Влажный корм Sirius 85 г для взрослых кошек");
  assert.equal(result.imageUrl, "https://sirius-pet.ru/upload/a.jpg");
});

test("skips category pages without product marker", () => {
  assert.equal(parseBrandPage("AlphaPet", "<html><title>Каталог</title></html>", "https://alphapet.ru/catalog/"), null);
  assert.equal(parseBrandPage("Sirius", "<html><title>Каталог</title></html>", "https://sirius-pet.ru/katalog/"), null);
});

test("parses sitemap urls", () => {
  assert.deepEqual(parseSitemap("<urlset><url><loc>https://a/1</loc></url><url><loc>https://a/2</loc></url></urlset>"), ["https://a/1", "https://a/2"]);
});
