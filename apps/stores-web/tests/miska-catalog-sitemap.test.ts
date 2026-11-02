import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  assertMiskaCatalogManifestIntegrity,
  getPublishedMiskaCatalogPaths,
  getPublishedMiskaCatalogProducts,
  MISKA_CATALOG_CATEGORIES,
  MISKA_CATALOG_HOME_PATH,
} from "@/lib/miska/published-catalog";
import {
  findCrossSitemapDuplicates,
  findIntraSitemapDuplicates,
  findMissingPublishedPaths,
  findUnpublishedListedPaths,
} from "@/scripts/seo-audit/coverage";
import {
  getMiskaSectionSitemapPaths,
  renderMiskaSectionSitemap,
} from "@/scripts/miska-section/build-pilot-sitemap";

const ORIGIN = "https://stores-test.local";

describe("miska catalog publication manifest", () => {
  test("manifest passes its own integrity invariants", () => {
    assert.doesNotThrow(() => assertMiskaCatalogManifestIntegrity());
  });

  test("catalog home, categories and every published product produce canonical paths", () => {
    const paths = getPublishedMiskaCatalogPaths();
    assert.ok(paths.includes(MISKA_CATALOG_HOME_PATH));
    for (const category of MISKA_CATALOG_CATEGORIES) {
      assert.ok(paths.includes(`/miska/katalog/${category.slug}/`), `missing category ${category.slug}`);
    }
    for (const product of getPublishedMiskaCatalogProducts()) {
      assert.ok(paths.includes(`/miska/tovary/${product.slug}/`), `missing product ${product.slug}`);
    }
    for (const path of paths) {
      assert.ok(path.endsWith("/"), `path must use the canonical trailing-slash form: ${path}`);
    }
    assert.equal(new Set(paths).size, paths.length, "paths must be unique");
  });

  test("every published product has a shortened title of at most 70 chars", () => {
    for (const product of getPublishedMiskaCatalogProducts()) {
      assert.ok(product.shortTitle.trim().length > 0, `${product.slug}: empty shortTitle`);
      assert.ok(
        product.shortTitle.length <= 70,
        `${product.slug}: shortTitle is ${product.shortTitle.length} chars (> 70)`,
      );
    }
  });
});

describe("pilot sitemap generator", () => {
  test("renders exactly the static bundle pages from the same manifest", () => {
    const paths = getMiskaSectionSitemapPaths();
    assert.ok(paths.includes("/miska/"));
    for (const path of getPublishedMiskaCatalogPaths()) {
      assert.ok(paths.includes(path), `pilot sitemap is missing ${path}`);
    }
    const xml = renderMiskaSectionSitemap(paths);
    const rendered = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    assert.equal(rendered.length, paths.length);
    assert.equal(new Set(rendered).size, rendered.length, "no duplicate URLs");
    for (const url of rendered) {
      assert.ok(url.startsWith("https://"), `must be absolute HTTPS: ${url}`);
      assert.ok(url.endsWith("/"), `must use trailing slash: ${url}`);
    }
    assert.ok(!xml.includes("<lastmod>"), "no fabricated lastmod dates");
  });
});

describe("sitemap coverage checks (audit core)", () => {
  test("regression: a published product page missing from every sitemap is flagged", () => {
    const published = getPublishedMiskaCatalogPaths();
    const missing = `/miska/tovary/${getPublishedMiskaCatalogProducts()[0].slug}/`;
    const sitemapUrls = new Set(
      published.filter((path) => path !== missing).map((path) => new URL(path, ORIGIN).href),
    );
    const issues = findMissingPublishedPaths(published, sitemapUrls, ORIGIN);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "error");
    assert.equal(issues[0].scope, missing);
  });

  test("complete sitemap coverage produces no errors", () => {
    const published = getPublishedMiskaCatalogPaths();
    const sitemapUrls = new Set(published.map((path) => new URL(path, ORIGIN).href));
    assert.deepEqual(findMissingPublishedPaths(published, sitemapUrls, ORIGIN), []);
  });

  test("an unpublished product listed in a sitemap is flagged", () => {
    const sitemapUrls = new Set([new URL("/miska/tovary/draft-product/", ORIGIN).href]);
    const issues = findUnpublishedListedPaths(["/miska/tovary/draft-product/"], sitemapUrls, ORIGIN);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "error");
  });

  test("duplicate URL inside one sitemap is an error", () => {
    const map = new Map([["sitemap.xml", ["https://a.test/x/", "https://a.test/x/"]]]);
    assert.equal(findIntraSitemapDuplicates(map).length, 1);
  });

  test("same URL in two sitemaps is an informational note, not an error", () => {
    const map = new Map([
      ["sitemap.xml", ["https://a.test/x/"]],
      ["sitemap-pilot.xml", ["https://a.test/x/"]],
    ]);
    const issues = findCrossSitemapDuplicates(map);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "warning");
  });
});
