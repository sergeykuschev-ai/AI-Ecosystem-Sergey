import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import StorePage from "@/app/stores/[city]/[store]/page";
import sitemap from "@/app/sitemap";
import { getStoreCategoryHref } from "@/lib/seo/store-category-links";

test("physical store category labels link directly to existing commercial owners", async () => {
  const paths = new Set((await sitemap()).map(({ url }) => new URL(url).pathname));
  const expected = { amper: 3, ventil: 4, "metiz-market": 5, miska: 6 };
  for (const [brand, count] of Object.entries(expected)) {
    const markup = renderToStaticMarkup(await StorePage({ params: Promise.resolve({ city: "amursk", store: brand + "-amursk" }) }));
    const section = markup.split('aria-labelledby="store-categories"')[1].split("</section>")[0];
    const links = [...section.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replace(/\/$/, "") + "/");
    assert.equal(links.length, count, brand + " category links");
    for (const href of links) assert.ok(paths.has(href), "missing indexable owner: " + href);
    assert.doesNotMatch(section, /паразит|antiparasit/i);
  }
});

test("catalog ownership remains brand scoped with safe fallback for unreviewed labels", () => {
  assert.equal(getStoreCategoryHref("amper", "Электроинструмент"), "/amper/elektroinstrument/");
  assert.equal(getStoreCategoryHref("metiz-market", "Болты"), "/metiz-market/bolty-gayki-shayby/");
  assert.equal(getStoreCategoryHref("miska", "Корма"), "/miska/korm-dlya-koshek-i-sobak/");
  for (const [brand, label] of [
    ["amper", "Расходные материалы"], ["miska", "Витамины и добавки"],
    ["miska", "Антипаразитарные средства"], ["ventil", "Корма"],
    ["unknown", "Корма"], ["toString", "Корма"], ["miska", "constructor"], ["", ""],
  ]) assert.equal(getStoreCategoryHref(brand, label), undefined);
});