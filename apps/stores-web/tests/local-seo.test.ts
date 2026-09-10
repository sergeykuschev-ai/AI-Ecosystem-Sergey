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

  test("Miska page keeps its local pet-store signals and useful links", () => {
    const page = source("app", "miska", "page.tsx");

    assert.match(String(miskaPage.metadata.title), /МИСКА ЗООМАГАЗИН/);
    assert.match(String(miskaPage.metadata.title), /зоотовары в Амурске/i);
    assert.ok(page.includes('heroTitle="Зоомагазин и зоотовары в Амурске"'));
    assert.ok(page.includes("купить корм"));
    assert.ok(page.includes("Основные направления:"));

    assert.ok(page.includes('contactsHref="/kontakty/"'));
    assert.ok(page.includes('cityHref="/stores/amursk/"'));
    assert.ok(page.includes('href="/bonus/"'));
  });
});
