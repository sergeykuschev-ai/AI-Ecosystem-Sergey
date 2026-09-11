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
  "sameAs",
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
    assert.equal(jsonLd["@id"], new URL("/#website", siteUrl).href);
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
      assert.equal(jsonLd.name, store.name, `name must come from the canonical store for ${slug}`);
      assert.equal(jsonLd.telephone, store.telephone, `telephone must come from the canonical store for ${slug}`);
      const address = jsonLd.address as JsonLdObject;
      assert.equal(address.streetAddress, store.address, `address must come from the canonical store for ${slug}`);
      assert.deepEqual(
        jsonLd.openingHoursSpecification,
        store.opening_hours.map((entry) => ({
          "@type": "OpeningHoursSpecification",
          dayOfWeek: entry.days,
          opens: entry.opens,
          closes: entry.closes,
        })),
        `opening hours must come from the canonical store for ${slug}`,
      );
      assert.equal(jsonLd.geo, undefined, `geo must not be emitted without confirmed coordinates for ${slug}`);
      assertNoFabricatedCommerceData(jsonLd, `store JSON-LD for ${slug}`);
    }
  });

  test("store entities mirror canonical application facts and omit incomplete geo", () => {
    const { brand, store } = storeForBrand("amper");
    const jsonLd = createStoreJsonLd(store, brand, amursk);
    const address = jsonLd.address as JsonLdObject;
    const hours = jsonLd.openingHoursSpecification as JsonLdObject[];

    assert.equal(jsonLd.name, store.name);
    assert.equal(jsonLd.url, new URL(`/stores/${amursk.slug}/${store.slug}/`, siteUrl).href);
    assert.equal(jsonLd.telephone, store.telephone);
    assert.equal(address.streetAddress, store.address);
    assert.equal(address.addressLocality, amursk.name);
    assert.deepEqual(
      hours.map(({ dayOfWeek, opens, closes }) => ({ dayOfWeek, opens, closes })),
      store.opening_hours.map((entry) => ({
        dayOfWeek: entry.days,
        opens: entry.opens,
        closes: entry.closes,
      })),
    );

    const withoutCompleteCoordinates = createStoreJsonLd(
      { ...store, longitude: null },
      brand,
      amursk,
    );
    assert.equal(withoutCompleteCoordinates.geo, undefined);
    assert.equal(withoutCompleteCoordinates.sameAs, undefined);
  });

  test("stores JSON-LD skips stores whose brand is missing", () => {
    const jsonLd = createStoresJsonLd(mockStores, [], amursk);
    const graph = jsonLd["@graph"] as JsonLdObject[];
    assert.equal(graph.length, 0);
  });

  test("stores graph deduplicates source rows and keeps one stable LocalBusiness ID per store", () => {
    const jsonLd = createStoresJsonLd([...mockStores, mockStores[0]], mockBrands, amursk);
    const graph = jsonLd["@graph"] as JsonLdObject[];
    const ids = graph.map((entry) => entry["@id"]);

    assert.equal(graph.length, mockStores.length, "duplicate source rows must not duplicate entities");
    assert.equal(new Set(ids).size, graph.length, "store JSON-LD must not contain duplicate entities");
    for (const store of mockStores) {
      const id = new URL(`/stores/amursk/${store.slug}/#business`, siteUrl).href;
      assert.equal(ids.filter((candidate) => candidate === id).length, 1, `${store.slug} must occur exactly once`);
    }
    for (const node of graph) {
      assert.equal(node["@context"], undefined, "graph nodes inherit the document context");
    }
  });


  test("breadcrumb JSON-LD uses absolute canonical item URLs", () => {
    const jsonLd = createBreadcrumbJsonLd([
      { name: "Главная", path: "/" },
      { name: "Миска", path: "/miska/" },
    ]);
    const items = jsonLd.itemListElement as JsonLdObject[];
    assert.equal(items[0].item, new URL("/", siteUrl).href);
    assert.equal(items[1].item, new URL("/miska/", siteUrl).href);
    assert.equal(jsonLd["@id"], new URL("/miska/#breadcrumb", siteUrl).href);
    assertNoFabricatedCommerceData(jsonLd, "breadcrumb JSON-LD");
  });
  test("all top-level entities serialize and have distinct stable IDs", () => {
    const outputs = [
      createWebsiteJsonLd(),
      createContactPageJsonLd(),
      createAboutPageJsonLd(),
      createFAQPageJsonLd(mockFaqs),
      createOrganizationsJsonLd(mockBrands),
      createStoresJsonLd(mockStores, mockBrands, amursk),
      createBreadcrumbJsonLd([{ name: "Главная", path: "/" }]),
    ];
    const ids: string[] = [];
    for (const output of outputs) {
      assert.doesNotThrow(() => JSON.parse(JSON.stringify(output)));
      if (typeof output["@id"] === "string") ids.push(output["@id"]);
      for (const node of (output["@graph"] as JsonLdObject[] | undefined) ?? []) {
        if (typeof node["@id"] === "string") ids.push(node["@id"]);
      }
    }
    assert.equal(new Set(ids).size, ids.length, "audited entity IDs must not conflict");
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
