import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createAboutPageJsonLd,
  createBreadcrumbJsonLd,
  createContactPageJsonLd,
  createFAQPageJsonLd,
  createOrganizationsJsonLd,
  createStoreJsonLd,
  createStoresJsonLd,
  createWebsiteJsonLd,
  type JsonLdObject,
} from "@/lib/seo/json-ld";
import { siteUrl } from "@/lib/seo/metadata";
import { mockBrands, mockCities, mockFaqs, mockStores } from "@/lib/data/mock-data";

const FORBIDDEN_KEYS = new Set([
  "aggregateRating",
  "review",
  "reviews",
  "reviewCount",
  "ratingValue",
  "offers",
  "offer",
  "price",
  "priceRange",
]);

function collectForbiddenKeys(value: unknown, path: string, found: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenKeys(item, `${path}[${index}]`, found));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as JsonLdObject)) {
    if (FORBIDDEN_KEYS.has(key)) found.push(`${path}.${key}`);
    collectForbiddenKeys(child, `${path}.${key}`, found);
  }
}

function assertNoFabricatedCommerceData(value: unknown, label: string): void {
  const found: string[] = [];
  collectForbiddenKeys(value, label, found);
  assert.deepEqual(found, [], `${label} must not emit fabricated ratings/reviews/offers`);
}

const amursk = mockCities.find((city) => city.slug === "amursk");
assert.ok(amursk, "mock data must include the amursk city");

function storeForBrand(slug: string) {
  const brand = mockBrands.find((item) => item.slug === slug);
  const store = mockStores.find((item) => item.brand_id === brand?.id);
  assert.ok(brand && store, `mock data must include a store for ${slug}`);
  return { brand, store };
}

describe("JSON-LD builders", () => {
  test("website JSON-LD points at the canonical site URL", () => {
    const jsonLd = createWebsiteJsonLd();
    assert.equal(jsonLd["@context"], "https://schema.org");
    assert.equal(jsonLd["@type"], "WebSite");
    assert.equal(jsonLd.url, siteUrl.href);
  });

  test("contact and about pages use canonical URLs", () => {
    assert.equal(createContactPageJsonLd().url, new URL("/kontakty/", siteUrl).href);
    assert.equal(createAboutPageJsonLd().url, new URL("/o-kompanii/", siteUrl).href);
  });

  test("FAQ JSON-LD includes every question and answer", () => {
    const jsonLd = createFAQPageJsonLd(mockFaqs);
    const mainEntity = jsonLd.mainEntity as JsonLdObject[];
    assert.equal(mainEntity.length, mockFaqs.length);
    assert.equal(mainEntity[0].name, mockFaqs[0].question);
  });

  test("organization graph covers every canonical brand with canonical @id", () => {
    const jsonLd = createOrganizationsJsonLd(mockBrands);
    const graph = jsonLd["@graph"] as JsonLdObject[];
    assert.equal(graph.length, mockBrands.length);
    for (const brand of mockBrands) {
      const node = graph.find((entry) => entry["@id"] === new URL(`/${brand.slug}/#organization`, siteUrl).href);
      assert.ok(node, `organization node for ${brand.slug}`);
      assert.equal(node.name, brand.name);
    }
  });

  test("store JSON-LD maps brand slugs to schema types and never fabricates commerce data", () => {
    const expectedTypes: Record<string, string> = {
      miska: "PetStore",
      amper: "HardwareStore",
      "metiz-market": "HardwareStore",
      ventil: "HomeGoodsStore",
    };
    for (const slug of Object.keys(expectedTypes)) {
      const { brand, store } = storeForBrand(slug);
      const jsonLd = createStoreJsonLd(store, brand, amursk);
      assert.equal(jsonLd["@type"], expectedTypes[slug], `schema type for ${slug}`);
      assert.equal(jsonLd["@id"], new URL(`/stores/amursk/${store.slug}/#business`, siteUrl).href);
      assertNoFabricatedCommerceData(jsonLd, `store JSON-LD for ${slug}`);
    }
  });

  test("stores JSON-LD skips stores whose brand is missing", () => {
    const jsonLd = createStoresJsonLd(mockStores, [], amursk);
    const graph = jsonLd["@graph"] as JsonLdObject[];
    assert.equal(graph.length, 0);
  });

  test("breadcrumb JSON-LD uses absolute canonical item URLs", () => {
    const jsonLd = createBreadcrumbJsonLd([
      { name: "Главная", path: "/" },
      { name: "Миска", path: "/miska/" },
    ]);
    const items = jsonLd.itemListElement as JsonLdObject[];
    assert.equal(items[0].item, new URL("/", siteUrl).href);
    assert.equal(items[1].item, new URL("/miska/", siteUrl).href);
    assertNoFabricatedCommerceData(jsonLd, "breadcrumb JSON-LD");
  });

  test("no builder output contains fabricated ratings, reviews or offers", () => {
    const outputs: Array<[string, unknown]> = [
      ["website", createWebsiteJsonLd()],
      ["contact", createContactPageJsonLd()],
      ["about", createAboutPageJsonLd()],
      ["faq", createFAQPageJsonLd(mockFaqs)],
      ["organizations", createOrganizationsJsonLd(mockBrands)],
      ["stores", createStoresJsonLd(mockStores, mockBrands, amursk)],
      ["breadcrumb", createBreadcrumbJsonLd([{ name: "Главная", path: "/" }])],
    ];
    for (const [label, output] of outputs) {
      assertNoFabricatedCommerceData(output, label);
    }
  });
});
