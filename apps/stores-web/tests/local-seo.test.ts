import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import type { Metadata } from "next";
import * as homePage from "@/app/page";
import * as akciiPage from "@/app/akcii/page";
import * as amperPage from "@/app/amper/page";
import * as bonusPage from "@/app/bonus/page";
import * as ventilPage from "@/app/ventil/page";
import * as faqPage from "@/app/faq/page";
import * as kontaktyPage from "@/app/kontakty/page";
import * as metizMarketPage from "@/app/metiz-market/page";
import * as miskaPage from "@/app/miska/page";
import * as oKompaniiPage from "@/app/o-kompanii/page";
import * as storesPage from "@/app/stores/page";
import * as vakansiiPage from "@/app/vakansii/page";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

const STATIC_PAGE_MODULES: Array<{ name: string; metadata: Metadata }> = [
  { name: "/", metadata: homePage.metadata },
  { name: "/akcii/", metadata: akciiPage.metadata },
  { name: "/amper/", metadata: amperPage.metadata },
  { name: "/bonus/", metadata: bonusPage.metadata },
  { name: "/faq/", metadata: faqPage.metadata },
  { name: "/kontakty/", metadata: kontaktyPage.metadata },
  { name: "/metiz-market/", metadata: metizMarketPage.metadata },
  { name: "/miska/", metadata: miskaPage.metadata },
  { name: "/o-kompanii/", metadata: oKompaniiPage.metadata },
  { name: "/stores/", metadata: storesPage.metadata },
  { name: "/vakansii/", metadata: vakansiiPage.metadata },
  { name: "/ventil/", metadata: ventilPage.metadata },
];

function source(...parts: string[]) {
  return readFileSync(join(projectRoot, ...parts), "utf8");
}

describe("local SEO internal linking", () => {
  test("static page metadata titles and descriptions stay unique", () => {
    const titles = STATIC_PAGE_MODULES.map((page) => page.metadata.title);
    const descriptions = STATIC_PAGE_MODULES.map((page) => page.metadata.description);
    assert.equal(new Set(titles).size, titles.length, "duplicate metadata titles across static pages");
    assert.equal(new Set(descriptions).size, descriptions.length, "duplicate metadata descriptions across static pages");
  });

  test("store pages link back to their brand landing page", () => {
    const page = source("app", "stores", "[city]", "[store]", "page.tsx");
    assert.ok(page.includes("href={`/${brand.slug}/`}"), "store page must link to the brand landing route");
  });

  test("city page links active city brands to their landing pages", () => {
    const page = source("app", "stores", "[city]", "page.tsx");
    assert.ok(page.includes("cityBrands"), "city page must derive active brands present in the city");
    assert.ok(page.includes("href={`/${brand.slug}/`}"), "city page must link each brand to its landing page");
    assert.ok(page.includes("createStoresJsonLd"), "city page must preserve its structured-data graph");
  });

  test("FAQ page links to useful local navigation targets", () => {
    const page = source("app", "faq", "page.tsx");
    for (const href of ["/kontakty/", "/stores/", "/bonus/"]) {
      assert.ok(page.includes(`href=\"${href}\"`), `FAQ page must link to ${href}`);
    }
  });
});

describe("Ампер local commercial signals", () => {
  const amperSource = source("app", "amper", "page.tsx");

  test("metadata and visible H1 identify Ампер as an electrical goods store in Amursk", () => {
    assert.match(String(amperPage.metadata.title), /Ампер.*магазин электротоваров в Амурске/i);
    assert.ok(
      amperSource.includes('heroTitle="«Ампер» — магазин электротоваров в Амурске"'),
      "visible H1 must connect the brand, category and city",
    );
  });

  test("local block uses approved assortment categories and confirmed store data", () => {
    for (const category of ["товары для электромонта", "освещение", "электроинструмент", "расходные материалы"]) {
      assert.ok(amperSource.includes(category), `Amper page must mention ${category}`);
    }

    const contactSource = source("components", "stores", "BrandStoreContact.tsx");
    for (const field of ["store.address", "store.opening_hours", "store.telephone", "store.map_links"]) {
      assert.ok(contactSource.includes(field), `local block must derive ${field} from store data`);
    }
  });

  test("page links to contacts, Amursk stores and bonus programme", () => {
    for (const href of ["/kontakty/", "/stores/amursk/", "/bonus/"]) {
      assert.ok(amperSource.includes(`\"${href}\"`), `Amper page must link to ${href}`);
    }
  });
});
