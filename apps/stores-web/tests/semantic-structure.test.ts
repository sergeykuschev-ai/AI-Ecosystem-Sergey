import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, test } from "node:test";
import { StaticPage } from "@/components/content/StaticPage";
import { ContactStoreGrid } from "@/components/contacts/ContactStoreGrid";
import { StoreList } from "@/components/stores/StoreList";
import { mockBrands, mockCities, mockStores } from "@/lib/data/mock-data";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

function source(relativePath: string): string {
  return readFileSync(join(projectRoot, ...relativePath.split("/")), "utf8");
}

function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

describe("key page heading ownership", () => {
  test("shared page shells own exactly one main landmark and h1", () => {
    const staticMarkup = renderToStaticMarkup(
      h(StaticPage, { className: "test-page", title: "Заголовок", intro: "Введение" }),
    );
    assert.equal(count(staticMarkup, /<main\b/g), 1);
    assert.equal(count(staticMarkup, /<h1\b/g), 1);

    const brandShell = source("components/brand/BrandLandingPage.tsx");
    assert.equal(count(brandShell, /<main\b/g), 1);
    assert.equal(count(brandShell, /<h1\b/g), 1);
  });

  test("key routes do not add a second main or h1 around their shared shell", () => {
    for (const page of [
      "app/stores/[city]/page.tsx",
      "app/amper/page.tsx",
      "app/ventil/page.tsx",
      "app/metiz-market/page.tsx",
      "app/miska/page.tsx",
      "app/kontakty/page.tsx",
      "app/bonus/page.tsx",
      "app/akcii/page.tsx",
      "app/faq/page.tsx",
    ]) {
      const pageSource = source(page);
      assert.equal(count(pageSource, /<main\b/g), 0, `${page} must use its shared main landmark`);
      assert.equal(count(pageSource, /<h1\b/g), 0, `${page} must use its shared page h1`);
    }

    const homeSource = source("app/page.tsx");
    assert.equal(count(homeSource, /<main\b/g), 1);
    assert.equal(count(homeSource, /<h1\b/g), 1);
  });
});

describe("section heading hierarchy", () => {
  test("brand feature sections use h2 section titles and h3 card titles", () => {
    for (const [page, sectionId] of [
      ["app/amper/page.tsx", "amper-about"],
      ["app/ventil/page.tsx", "ventil-directions"],
      ["app/metiz-market/page.tsx", "metiz-directions"],
      ["app/miska/page.tsx", "miska-directions"],
    ]) {
      const pageSource = source(page);
      assert.match(pageSource, new RegExp(`aria-labelledby="${sectionId}"`));
      assert.match(pageSource, new RegExp(`<h2 id="${sectionId}">`));
      assert.match(pageSource, /<article[^>]*>[\s\S]*?<h3>/);
    }
  });

  test("promotions and FAQ content sections have explicit h2 labels", () => {
    const promotions = source("app/akcii/page.tsx");
    assert.match(promotions, /<section[^>]*aria-labelledby="promotions-title">[\s\S]*?<h2 id="promotions-title">/);

    const faq = source("app/faq/page.tsx");
    assert.match(faq, /<section[^>]*aria-labelledby="faq-answers">[\s\S]*?<h2 id="faq-answers">/);
  });
});

describe("store contact semantics", () => {
  test("city and contact cards expose store addresses with address elements", () => {
    const city = mockCities[0];
    const storesMarkup = renderToStaticMarkup(h(StoreList, { stores: mockStores, brands: mockBrands, city }));
    const contactsMarkup = renderToStaticMarkup(h(ContactStoreGrid, { stores: mockStores, brands: mockBrands, city }));

    assert.equal(count(storesMarkup, /<address class="store-address">/g), mockStores.length);
    assert.equal(count(contactsMarkup, /<address class="store-address">/g), mockStores.length);
  });
});
