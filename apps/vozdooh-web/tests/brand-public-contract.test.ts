import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { BRANDS } from "@/lib/brands/brands";
import { getNoStoryNotice, getPublicBrand, getPublicBrands } from "@/lib/brands/public";
import { getProductsByBrand } from "@/lib/catalog/products";
import sitemap from "@/app/sitemap";
import { buildBrandJsonLd, buildBrandsIndexJsonLd } from "@/lib/seo/json-ld";
import { buildBrandDescription, buildBrandMetadata } from "@/lib/seo/metadata";

const KNOWN_ROUTES = new Set<string>(["/", "/brands"]);
for (const brand of getPublicBrands()) {
  KNOWN_ROUTES.add(`/brands/${brand.slug}`);
}

describe("public page contract", () => {
  test("public brand view exposes only verified claims", () => {
    for (const brand of getPublicBrands()) {
      for (const claim of brand.verifiedClaims) {
        assert.equal(claim.status, "verified");
        assert.ok(claim.source, `public claim ${claim.id} lost its source`);
      }
      assert.equal(
        brand.hasVerifiedStory,
        brand.verifiedClaims.length > 0,
        `${brand.slug}: hasVerifiedStory flag mismatch`,
      );
    }
  });

  test("needs_source statements never leak into SEO descriptions", () => {
    for (const brand of getPublicBrands()) {
      const description = buildBrandDescription(brand);
      const raw = BRANDS.find((entry) => entry.slug === brand.slug);
      assert.ok(raw);
      for (const claim of raw.claims) {
        if (claim.status === "needs_source") {
          assert.ok(
            !description.includes(claim.statement),
            `needs_source statement leaked into description for ${brand.slug}`,
          );
        }
      }
      for (const claim of brand.verifiedClaims) {
        assert.ok(description.includes(claim.statement), `verified fact missing from description for ${brand.slug}`);
      }
      assert.ok(description.includes("товар"), `catalog presence missing from description for ${brand.slug}`);
    }
  });

  test("brand metadata uses verified facts only and sane lengths", () => {
    for (const brand of getPublicBrands()) {
      const metadata = buildBrandMetadata(brand);
      assert.ok(String(metadata.title ?? "").includes(brand.name));
      const description = String(metadata.description ?? "");
      assert.ok(description.length > 0);
      assert.ok(description.length <= 300, `description too long for ${brand.slug}: ${description.length}`);
      assert.ok(
        String(metadata.alternates?.canonical ?? "").endsWith(`/brands/${brand.slug}`),
        `canonical mismatch for ${brand.slug}`,
      );
    }
  });

  test("no-story notice contains no brand-specific facts", () => {
    const notice = getNoStoryNotice();
    for (const brand of BRANDS) {
      assert.ok(!notice.includes(brand.name), "notice must not name brands");
    }
  });
});

describe("structured data contract", () => {
  test("brand JSON-LD contains WebPage, Brand, BreadcrumbList and an item per product", () => {
    for (const brand of getPublicBrands()) {
      const products = getProductsByBrand(brand.slug);
      const jsonLd = buildBrandJsonLd(brand, products);
      assert.equal(jsonLd["@context"], "https://schema.org");
      const graph = jsonLd["@graph"] as Array<Record<string, unknown>>;
      const types = graph.map((node) => node["@type"]);
      assert.ok(types.includes("WebPage"));
      assert.ok(types.includes("Brand"));
      assert.ok(types.includes("BreadcrumbList"));
      assert.ok(types.includes("ItemList"));
      const brandNode = graph.find((node) => node["@type"] === "Brand");
      assert.equal(brandNode?.name, brand.name);
      const itemList = graph.find((node) => node["@type"] === "ItemList");
      const items = itemList?.itemListElement as Array<{ position: number }>;
      assert.equal(items.length, products.length);
      const serialized = JSON.stringify(jsonLd);
      const raw = BRANDS.find((entry) => entry.slug === brand.slug);
      for (const claim of raw?.claims ?? []) {
        if (claim.status === "needs_source") {
          assert.ok(!serialized.includes(claim.statement), `needs_source leaked into JSON-LD for ${brand.slug}`);
        }
      }
      assert.doesNotThrow(() => JSON.parse(serialized));
    }
  });

  test("brands index JSON-LD lists every public brand", () => {
    const brands = getPublicBrands();
    const jsonLd = buildBrandsIndexJsonLd(brands);
    const mainEntity = jsonLd.mainEntity as { itemListElement: Array<{ item: { name: string; url: string } }> };
    const listed = mainEntity.itemListElement.map((entry) => entry.item.name).sort();
    assert.deepEqual(listed, brands.map((brand) => brand.name).sort());
    for (const entry of mainEntity.itemListElement) {
      assert.ok(KNOWN_ROUTES.has(entry.item.url.replace(/^https?:\/\/[^/]+/, "")));
    }
  });
});

describe("routes and sitemap", () => {
  test("sitemap lists home, brands index and every brand page", () => {
    const urls = sitemap().map((entry) => entry.url.replace(/^https?:\/\/[^/]+/, ""));
    assert.ok(urls.includes("/"));
    assert.ok(urls.includes("/brands"));
    for (const brand of getPublicBrands()) {
      assert.ok(urls.includes(`/brands/${brand.slug}`), `sitemap missing ${brand.slug}`);
    }
    assert.equal(urls.length, KNOWN_ROUTES.size, "sitemap must not contain unknown routes");
  });

  test("unknown brand slug has no public page and no metadata", () => {
    assert.equal(getPublicBrand("no-such-brand"), undefined);
  });
});

describe("no fake brand assets", () => {
  test("brand components do not reference images that do not exist", () => {
    const componentsDir = path.resolve(process.cwd(), "components/brands");
    const files = readdirSync(componentsDir).filter((name) => name.endsWith(".tsx"));
    assert.ok(files.length > 0, "brand components must exist");
    for (const file of files) {
      const source = readFileSync(path.join(componentsDir, file), "utf8");
      assert.ok(!source.includes("next/image"), `${file} must not use next/image (no brand assets yet)`);
      assert.ok(!/<img[\s>]/.test(source), `${file} must not render <img> (no brand assets yet)`);
    }
  });

  test("public brand asset directory is empty or absent", () => {
    const publicBrandsDir = path.resolve(process.cwd(), "public/brands");
    assert.ok(
      !existsSync(publicBrandsDir) || readdirSync(publicBrandsDir).length === 0,
      "public/brands must not contain placeholder assets",
    );
  });
});
