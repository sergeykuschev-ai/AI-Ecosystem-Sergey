import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Metadata } from "next";
import { BrandStoreContact } from "@/components/stores/BrandStoreContact";
import { StoreContactBlock } from "@/components/stores/StoreContactBlock";
import { mockBrands, mockCities, mockStores } from "@/lib/data/mock-data";
import * as homePage from "@/app/page";
import * as amperPage from "@/app/amper/page";
import * as bonusPage from "@/app/bonus/page";
import * as faqPage from "@/app/faq/page";
import * as ventilPage from "@/app/ventil/page";
import * as kontaktyPage from "@/app/kontakty/page";
import * as metizMarketPage from "@/app/metiz-market/page";
import * as miskaPage from "@/app/miska/page";
import * as oKompaniiPage from "@/app/o-kompanii/page";
import * as storesPage from "@/app/stores/page";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { siteUrl } from "@/lib/seo/metadata";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

const STATIC_PAGE_MODULES: Array<{ name: string; metadata: Metadata }> = [
  { name: "/", metadata: homePage.metadata },
  { name: "/amper/", metadata: amperPage.metadata },
  { name: "/bonus/", metadata: bonusPage.metadata },
  { name: "/metiz-market/", metadata: metizMarketPage.metadata },
  { name: "/miska/", metadata: miskaPage.metadata },
  { name: "/o-kompanii/", metadata: oKompaniiPage.metadata },
  { name: "/stores/", metadata: storesPage.metadata },
  { name: "/ventil/", metadata: ventilPage.metadata },
];

function source(...parts: string[]) {
  return readFileSync(join(projectRoot, ...parts), "utf8");
}

describe("local SEO internal linking", () => {
  test("all store contact views render NAP from the same canonical store records", () => {
    const city = mockCities.find((item) => item.slug === "amursk");
    assert.ok(city);

    for (const store of mockStores) {
      const brand = mockBrands.find((item) => item.id === store.brand_id);
      assert.ok(brand, `brand for ${store.slug}`);
      const markup = [
        renderToStaticMarkup(h(StoreContactBlock, { store })),
        renderToStaticMarkup(h(BrandStoreContact, { store, brand, city })),
      ].join("\n");

      assert.ok(store.address && markup.includes(store.address), `address for ${store.slug}`);
      assert.ok(store.telephone && markup.includes(store.telephone), `telephone for ${store.slug}`);
      for (const hours of store.opening_hours) {
        if (hours.opens) assert.ok(markup.includes(hours.opens), `opening time for ${store.slug}`);
        if (hours.closes) assert.ok(markup.includes(hours.closes), `closing time for ${store.slug}`);
      }
    }
  });

  test("static page metadata titles and descriptions stay unique", async () => {
    const pages = [
      ...STATIC_PAGE_MODULES,
      { name: "/kontakty/", metadata: await kontaktyPage.generateMetadata() },
      { name: "/faq/", metadata: await faqPage.generateMetadata() },
    ];
    const titles = pages.map((page) => page.metadata.title);
    const descriptions = pages.map((page) => page.metadata.description);
    assert.equal(new Set(titles).size, titles.length, "duplicate metadata titles across static pages");
    assert.equal(new Set(descriptions).size, descriptions.length, "duplicate metadata descriptions across static pages");
  });

  test("critical page H1 values stay unique", () => {
    const staticH1Values = [
      "Четыре магазина. Всё для дома, ремонта и питомцев.",
      "Магазины",
      "Акции",
      "Бонусная программа",
      "Вакансии",
      "Четыре магазина в центре Амурска",
      "Наши магазины в Амурске",
      "Частые вопросы",
    ];
    const h1Values = [
      ...staticH1Values,
      ...mockBrands.filter((brand) => brand.active).map((brand) => brand.name),
      ...mockCities.filter((city) => city.active).map((city) => `Магазины в ${city.name}`),
      ...mockStores.filter((store) => store.active).map((store) => store.name),
    ];

    assert.ok(h1Values.every((value) => value.trim().length > 0), "critical H1 values must be non-empty");
    assert.equal(new Set(h1Values).size, h1Values.length, "duplicate H1 values across critical pages");
  });

  test("store pages link back to their brand landing page", () => {
    const page = source("app", "stores", "[city]", "[store]", "page.tsx");
    assert.ok(page.includes("href={`/${brand.slug}/`}"), "store page must link to the brand landing route");
    assert.ok(page.includes('href="/kontakty/"'), "store page must link to the contacts route");
  });

  test("visible breadcrumbs and BreadcrumbList share one canonical trail", () => {
    const trail = [
      { name: "Главная", path: "/" },
      { name: "Магазины Амурска", path: "/stores/amursk/" },
      { name: "Ампер", path: "/stores/amursk/amper/" },
    ];
    const markup = renderToStaticMarkup(h(Breadcrumbs, { trail }));
    const script = markup.match(/<script type="application\/ld\+json">(.+)<\/script>/);
    assert.ok(script, "breadcrumbs must expose BreadcrumbList JSON-LD");
    const jsonLd = JSON.parse(script[1]) as { itemListElement: Array<{ name: string; item: string }> };

    assert.deepEqual(jsonLd.itemListElement.map(({ name }) => name), trail.map(({ name }) => name));
    assert.deepEqual(
      jsonLd.itemListElement.map(({ item }) => item),
      trail.map(({ path }) => new URL(path, siteUrl).href),
    );
    for (const { path } of trail.slice(0, -1)) {
      assert.ok(markup.includes(`href="${path}"`), `visible breadcrumb is missing ${path}: ${markup}`);
    }
  });

  test("city, store, and brand pages use the same city-first breadcrumb hierarchy", () => {
    const cityPage = source("app", "stores", "[city]", "page.tsx");
    const storePage = source("app", "stores", "[city]", "[store]", "page.tsx");
    const brandPage = source("components", "brand", "BrandLandingPage.tsx");
    for (const page of [cityPage, storePage, brandPage]) {
      assert.ok(page.includes('{ name: "Главная", path: "/" }'));
      assert.ok(page.includes('{ name: "Магазины", path: "/stores/" }'));
      assert.ok(page.includes('{ name: city.name, path: `/stores/${city.slug}/` }'));
    }
    assert.ok(storePage.includes('{ name: store.name, path: `/stores/${city.slug}/${store.slug}/` }'));
    assert.ok(brandPage.includes('{ name: brand.name, path: `/${brand.slug}/` }'));
  });

  test("city page links active city brands to their landing pages", () => {
    const page = source("app", "stores", "[city]", "page.tsx");
    assert.ok(page.includes("cityBrands"), "city page must derive active brands present in the city");
    assert.ok(page.includes("href={`/${brand.slug}/`}"), "city page must link each brand to its landing page");
    assert.ok(page.includes('href="/kontakty/"'), "city page must link to the canonical contacts page");
    assert.ok(page.includes("createStoresJsonLd"), "city page must preserve its structured-data graph");
    assert.ok(page.includes("<Breadcrumbs"), "city page must expose canonical breadcrumbs");
    assert.ok(page.includes('href="/kontakty/"'), "city page must link to the contacts route");
  });

  test("contacts page links to the canonical Amursk stores route and exposes breadcrumbs", () => {
    const page = source("app", "kontakty", "page.tsx");
    assert.ok(page.includes("`/stores/${city.slug}/`"), "contacts page must derive the city stores route");
    assert.ok(page.includes("createBreadcrumbJsonLd"), "contacts page must expose canonical breadcrumbs");
  });

  test("city hub identifies all four Amursk stores and their directions", () => {
    const page = source("app", "stores", "[city]", "page.tsx");
    for (const description of [
      "«Ампер» — электротовары",
      "«Вентиль» — сантехника",
      "«Метиз Маркет» — крепёж, метизы и инструмент",
      "«Миска» — зоотовары",
    ]) {
      assert.ok(page.includes(description), `city hub must include: ${description}`);
    }
    assert.ok(page.includes("4 магазина в"), "city H1 must describe the four-store local hub");
  });

  test("city hub emits one store graph and one breadcrumb trail", () => {
    const page = source("app", "stores", "[city]", "page.tsx");
    assert.equal(page.match(/createStoresJsonLd\(stores, brands, city\)/g)?.length, 1);
    assert.equal(page.match(/<Breadcrumbs/g)?.length, 1);
  });

  test("FAQ page links to useful local navigation targets", () => {
    const page = source("app", "faq", "page.tsx");
    for (const href of ["/kontakty/", "/stores/", "/bonus/"]) {
      assert.ok(page.includes(`href=\"${href}\"`), `FAQ page must link to ${href}`);
    }
  });

  test("Ventil page preserves local commercial signals for Amursk", () => {
    const page = source("app", "ventil", "page.tsx");
    const normalizedPage = page.toLocaleLowerCase("ru");
    const title = String(ventilPage.metadata.title);
    const description = String(ventilPage.metadata.description);

    assert.match(title, /Вентиль.*магазин сантехники в Амурске/i);
    assert.match(description, /магазин сантехники.*в Амурске/i);
    assert.ok(
      page.includes('heroTitle="Сантехника, водоснабжение и отопление в Амурске"'),
      "visible H1 must connect Ventil's offer with Amursk",
    );
    assert.ok(
      page.includes('heroLead="Магазин сантехники на проспекте Победы, 16:'),
      "visible lead must identify the local plumbing store and its confirmed address",
    );

    for (const direction of [
      "Сантехника",
      "Водоснабжение",
      "Отопление",
      "Арматура",
      "Смесители",
      "Канализация",
      "Расходные материалы",
    ]) {
      assert.ok(normalizedPage.includes(direction.toLocaleLowerCase("ru")), `Ventil page must mention ${direction}`);
    }

    for (const href of ["/kontakty/", "/bonus/"]) {
      assert.ok(page.includes(`\"${href}\"`), `Ventil page must link to ${href}`);
    }
    const contactSource = source("components", "stores", "BrandStoreContact.tsx");
    assert.ok(contactSource.includes("href={`/stores/${city.slug}/`}"), "shared contact block must link to the city hub");
  });
});
