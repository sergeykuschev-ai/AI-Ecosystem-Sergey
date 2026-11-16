import assert from "node:assert/strict";
import { test } from "node:test";
import { metadata } from "@/app/amper/page";
import { getAmperSeoCategory } from "@/lib/amper/seo-categories";
import sitemap from "@/app/sitemap";
import { getPublishedArticles } from "@/lib/articles/articles";

test("Amper metadata and cable introduction identify the local store without stock promises", () => {
  assert.match(String(metadata.title), /магазин электрики в Амурске/);
  const cable = getAmperSeoCategory("kabel-i-provod");
  assert.match(cable.lead, /«Ампер» в Амурске, проспект Победы, 16/);
  assert.match(cable.lead, /Наличие .* уточняйте/);
  assert.equal(cable.h1, "Кабель и провод в Амурске");
});

test("mock sitemap inventory is reproducible and includes both audited routes once", async () => {
  const paths = (await sitemap()).map((entry) => new URL(entry.url).pathname);
  assert.equal(paths.length, new Set(paths).size);
  for (const path of ["/amper/", "/amper/kabel-i-provod/"]) {
    assert.equal(paths.filter((item) => item === path).length, 1);
  }
  const articles = paths.filter((path) => path.startsWith("/stati/") && path !== "/stati/");
  assert.equal(articles.length, getPublishedArticles().length);
  console.log(JSON.stringify({ sitemapInventory: paths, count: paths.length, articleCount: articles.length }));
});
