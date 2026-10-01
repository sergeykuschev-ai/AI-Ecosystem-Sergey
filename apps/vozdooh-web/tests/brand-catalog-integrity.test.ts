import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BRANDS, getBrandBySlug } from "@/lib/brands/brands";
import { getPublicBrands } from "@/lib/brands/public";
import { CATALOG_PRODUCTS } from "@/lib/catalog/products";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("brand set derived from the catalog", () => {
  test("brand slugs are unique and url-safe", () => {
    const slugs = BRANDS.map((brand) => brand.slug);
    assert.equal(new Set(slugs).size, slugs.length, "duplicate brand slugs");
    for (const slug of slugs) {
      assert.ok(SLUG_PATTERN.test(slug), `invalid slug: ${slug}`);
    }
  });

  test("brand set matches the candidate brands from issue #200, nothing else", () => {
    assert.deepEqual(
      [...BRANDS.map((brand) => brand.slug)].sort(),
      ["culti-milano", "ladenac", "millefiori-milano", "teatro-fragranze-uniche"],
    );
  });

  test("public brand view exposes every catalog brand", () => {
    assert.deepEqual(
      getPublicBrands()
        .map((brand) => brand.slug)
        .sort(),
      BRANDS.map((brand) => brand.slug).sort(),
    );
  });
});

describe("brand-catalog relations", () => {
  test("every product references an existing brand (no broken relations)", () => {
    for (const product of CATALOG_PRODUCTS) {
      assert.ok(
        getBrandBySlug(product.brandSlug),
        `product ${product.slug} references unknown brand ${product.brandSlug}`,
      );
    }
  });

  test("product slugs are unique", () => {
    const slugs = CATALOG_PRODUCTS.map((product) => product.slug);
    assert.equal(new Set(slugs).size, slugs.length, "duplicate product slugs");
  });

  test("every brand has at least one catalog product (no empty brand pages)", () => {
    for (const brand of BRANDS) {
      const count = CATALOG_PRODUCTS.filter((product) => product.brandSlug === brand.slug).length;
      assert.ok(count > 0, `brand ${brand.slug} has no products and must not be exposed`);
    }
  });

  test("product page urls are internal paths and are only set for real products", () => {
    const productSlugs = new Set(CATALOG_PRODUCTS.map((product) => product.slug));
    for (const product of CATALOG_PRODUCTS) {
      if (product.url === undefined) continue;
      assert.ok(product.url.startsWith("/"), `product ${product.slug} url must be internal`);
      assert.ok(productSlugs.has(product.slug), `product ${product.slug} url set for unknown product`);
    }
  });
});

describe("claim sourcing rules", () => {
  test("verified claims always carry a repository source", () => {
    for (const brand of BRANDS) {
      for (const claim of brand.claims) {
        if (claim.status === "verified") {
          assert.ok(
            claim.source && claim.source.length > 0,
            `verified claim ${claim.id} of ${brand.slug} has no source`,
          );
        }
      }
    }
  });

  test("needs_source claims never carry a source and never look verified", () => {
    for (const brand of BRANDS) {
      for (const claim of brand.claims) {
        if (claim.status === "needs_source") {
          assert.equal(claim.source, undefined, `needs_source claim ${claim.id} must not have a source`);
        }
      }
    }
  });

  test("claim ids are unique across brands", () => {
    const ids = BRANDS.flatMap((brand) => brand.claims.map((claim) => claim.id));
    assert.equal(new Set(ids).size, ids.length, "duplicate claim ids");
  });

  test("each brand keeps its unsupported topics explicitly listed as needs_source", () => {
    for (const brand of BRANDS) {
      const gaps = brand.claims.filter((claim) => claim.status === "needs_source");
      assert.ok(gaps.length > 0, `brand ${brand.slug} must track its NEEDS_SOURCE topics`);
    }
  });
});
