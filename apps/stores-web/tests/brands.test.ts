import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BRAND_PALETTE, CANONICAL_BRAND_SLUGS, isCanonicalBrandSlug } from "@/lib/constants/brands";
import { mockBrands } from "@/lib/data/mock-data";

const EXPECTED_PALETTE: Record<string, { primaryColor: string; secondaryColor: string }> = {
  amper: { primaryColor: "#f4c300", secondaryColor: "#fff7cc" },
  ventil: { primaryColor: "#1769aa", secondaryColor: "#e8f2fb" },
  "metiz-market": { primaryColor: "#c62828", secondaryColor: "#f2f3f5" },
  miska: { primaryColor: "#1a7a3a", secondaryColor: "#fdeede" },
};

describe("canonical brand slugs", () => {
  test("slug list is exactly amper, ventil, metiz-market, miska", () => {
    assert.deepEqual([...CANONICAL_BRAND_SLUGS], ["amper", "ventil", "metiz-market", "miska"]);
  });

  test("slug list has no duplicates", () => {
    assert.equal(new Set(CANONICAL_BRAND_SLUGS).size, CANONICAL_BRAND_SLUGS.length);
  });

  test("isCanonicalBrandSlug accepts canonical slugs and rejects others", () => {
    for (const slug of CANONICAL_BRAND_SLUGS) assert.equal(isCanonicalBrandSlug(slug), true);
    for (const slug of ["ampere", "metiz", "miska2", "", "AMPER"]) {
      assert.equal(isCanonicalBrandSlug(slug), false);
    }
  });
});

describe("required brand palette", () => {
  test("palette is defined for every canonical slug and nothing else", () => {
    assert.deepEqual(Object.keys(BRAND_PALETTE).sort(), [...CANONICAL_BRAND_SLUGS].sort());
  });

  test("palette matches the required primary/secondary values", () => {
    for (const [slug, colors] of Object.entries(EXPECTED_PALETTE)) {
      assert.deepEqual(BRAND_PALETTE[slug as keyof typeof BRAND_PALETTE], colors, `palette for ${slug}`);
    }
  });

  test("palette colors are valid lowercase hex", () => {
    for (const [slug, colors] of Object.entries(BRAND_PALETTE)) {
      for (const [key, value] of Object.entries(colors)) {
        assert.match(value, /^#[0-9a-f]{6}$/, `${slug}.${key}`);
      }
    }
  });
});

describe("mock brand data follows the canonical invariants", () => {
  test("every mock brand uses a canonical slug and the required palette", () => {
    assert.equal(mockBrands.length, CANONICAL_BRAND_SLUGS.length);
    for (const brand of mockBrands) {
      assert.equal(isCanonicalBrandSlug(brand.slug), true, `slug ${brand.slug}`);
      const palette = BRAND_PALETTE[brand.slug as keyof typeof BRAND_PALETTE];
      assert.equal(brand.primary_color, palette.primaryColor, `primary color for ${brand.slug}`);
      assert.equal(brand.secondary_color, palette.secondaryColor, `secondary color for ${brand.slug}`);
      assert.equal(brand.active, true);
    }
  });

  test("mock brand slugs are unique", () => {
    assert.equal(new Set(mockBrands.map((brand) => brand.slug)).size, mockBrands.length);
  });
});
