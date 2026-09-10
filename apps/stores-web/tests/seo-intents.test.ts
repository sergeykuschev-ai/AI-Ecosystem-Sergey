import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Metadata } from "next";
import * as homePage from "@/app/page";
import * as akciiPage from "@/app/akcii/page";
import * as amperPage from "@/app/amper/page";
import * as bonusPage from "@/app/bonus/page";
import * as faqPage from "@/app/faq/page";
import * as kontaktyPage from "@/app/kontakty/page";
import * as metizMarketPage from "@/app/metiz-market/page";
import * as miskaPage from "@/app/miska/page";
import * as oKompaniiPage from "@/app/o-kompanii/page";
import * as storesPage from "@/app/stores/page";
import * as vakansiiPage from "@/app/vakansii/page";
import * as ventilPage from "@/app/ventil/page";
import { mockCities, mockStores } from "@/lib/data/mock-data";
import {
  createCityPageSeo,
  createStorePageSeo,
  INDEXABLE_STATIC_PAGE_SEO,
  type IndexablePageSeo,
} from "@/lib/seo/page-intents";

const metadataByPath = new Map<string, Metadata>([
  ["/", homePage.metadata],
  ["/akcii/", akciiPage.metadata],
  ["/amper/", amperPage.metadata],
  ["/bonus/", bonusPage.metadata],
  ["/faq/", faqPage.metadata],
  ["/kontakty/", kontaktyPage.metadata],
  ["/metiz-market/", metizMarketPage.metadata],
  ["/miska/", miskaPage.metadata],
  ["/o-kompanii/", oKompaniiPage.metadata],
  ["/stores/", storesPage.metadata],
  ["/vakansii/", vakansiiPage.metadata],
  ["/ventil/", ventilPage.metadata],
]);

function assertUnique(records: readonly IndexablePageSeo[], field: keyof IndexablePageSeo) {
  const seen = new Map<string, string>();
  for (const record of records) {
    const value = record[field].trim().toLocaleLowerCase("ru");
    const previous = seen.get(value);
    assert.equal(previous, undefined, `${String(field)} duplicate: ${previous} and ${record.path}`);
    seen.set(value, record.path);
  }
}

describe("indexable URL intent map", () => {
  const city = mockCities[0];
  const records: IndexablePageSeo[] = [
    ...INDEXABLE_STATIC_PAGE_SEO,
    createCityPageSeo(city),
    ...mockStores.map((store) => createStorePageSeo(store, city)),
  ];

  test("matches metadata exported by every static indexable page", () => {
    assert.equal(metadataByPath.size, INDEXABLE_STATIC_PAGE_SEO.length);
    for (const expected of INDEXABLE_STATIC_PAGE_SEO) {
      const actual = metadataByPath.get(expected.path);
      assert.ok(actual, `missing page module for ${expected.path}`);
      assert.equal(actual.title, expected.title, `title drift on ${expected.path}`);
      assert.equal(actual.description, expected.description, `description drift on ${expected.path}`);
    }
  });

  test("keeps title, description, H1 and primary intent unique", () => {
    for (const field of ["title", "description", "h1", "intent"] as const) {
      assertUnique(records, field);
    }
  });

  test("keeps metadata concise", () => {
    for (const record of records) {
      assert.ok(record.title.length >= 10 && record.title.length <= 75, `title length ${record.title.length} on ${record.path}`);
      assert.ok(record.description.length >= 70 && record.description.length <= 180, `description length ${record.description.length} on ${record.path}`);
    }
  });

  test("separates directory, contact, brand and store-detail intents", () => {
    const cityPage = createCityPageSeo(city);
    const contacts = INDEXABLE_STATIC_PAGE_SEO.find((page) => page.path === "/kontakty/");
    assert.ok(contacts);
    assert.match(cityPage.intent, /торговой точки/i);
    assert.match(contacts.intent, /телефоны|связи/i);

    for (const brandPath of ["/amper/", "/ventil/", "/metiz-market/", "/miska/"]) {
      const brand = INDEXABLE_STATIC_PAGE_SEO.find((page) => page.path === brandPath);
      assert.ok(brand);
      assert.match(brand.intent, /ассортимент/i);
    }
    for (const store of mockStores) {
      assert.match(createStorePageSeo(store, city).intent, /адрес, телефон и режим работы/i);
    }
  });
});
