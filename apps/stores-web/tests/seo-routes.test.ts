import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Metadata } from "next";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { CANONICAL_BRAND_SLUGS } from "@/lib/constants/brands";
import { siteUrl } from "@/lib/seo/metadata";
import { mockCities, mockStores } from "@/lib/data/mock-data";
import * as amperPage from "@/app/amper/page";
import * as ventilPage from "@/app/ventil/page";
import * as metizMarketPage from "@/app/metiz-market/page";
import * as miskaPage from "@/app/miska/page";
import * as privacyPage from "@/app/politika-konfidencialnosti/page";
import * as consentPage from "@/app/soglasie-na-obrabotku-dannyh/page";

const PUBLIC_STATIC_PATHS = [
  "/",
  "/stores/",
  "/akcii/",
  "/bonus/",
  "/vakansii/",
  "/o-kompanii/",
  "/kontakty/",
  "/faq/",
];

const LEGAL_PATHS = ["/politika-konfidencialnosti/", "/soglasie-na-obrabotku-dannyh/"];

const BRAND_PAGES = [
  { module: amperPage, path: "/amper/" },
  { module: ventilPage, path: "/ventil/" },
  { module: metizMarketPage, path: "/metiz-market/" },
  { module: miskaPage, path: "/miska/" },
];

function canonicalHref(metadata: Metadata): string {
  const canonical = metadata.alternates?.canonical;
  assert.ok(canonical instanceof URL, "canonical alternate must be an absolute URL");
  return canonical.href;
}

function robotsFlags(metadata: Metadata): { index?: boolean; follow?: boolean } {
  const robots = metadata.robots;
  if (typeof robots === "string" || robots == null) return {};
  return robots as { index?: boolean; follow?: boolean };
}

describe("page metadata", () => {
  test("brand pages expose canonical indexable metadata on canonical brand routes", () => {
    for (const { module, path } of BRAND_PAGES) {
      const href = canonicalHref(module.metadata);
      assert.equal(href, new URL(path, siteUrl).href, `canonical for ${path}`);
      assert.equal(robotsFlags(module.metadata).index, true, `index for ${path}`);
      assert.ok(module.metadata.title, `title for ${path}`);
      assert.ok(module.metadata.description, `description for ${path}`);
    }
  });

  test("legal pages are excluded from indexing", () => {
    for (const [name, module] of [
      ["politika-konfidencialnosti", privacyPage],
      ["soglasie-na-obrabotku-dannyh", consentPage],
    ] as const) {
      assert.equal(robotsFlags(module.metadata).index, false, `${name} must be noindex`);
      assert.equal(robotsFlags(module.metadata).follow, false, `${name} must be nofollow`);
      canonicalHref(module.metadata);
    }
  });
});

describe("sitemap", () => {
  test("includes every required public route", async () => {
    const entries = await sitemap();
    const urls = new Set(entries.map((entry) => entry.url));
    const expected = PUBLIC_STATIC_PATHS.map((path) => new URL(path, siteUrl).href);
    for (const url of expected) assert.ok(urls.has(url), `sitemap must include ${url}`);
  });

  test("includes every canonical brand route", async () => {
    const entries = await sitemap();
    const urls = new Set(entries.map((entry) => entry.url));
    for (const slug of CANONICAL_BRAND_SLUGS) {
      const url = new URL(`/${slug}/`, siteUrl).href;
      assert.ok(urls.has(url), `sitemap must include ${url}`);
    }
  });

  test("includes city and store routes from content data", async () => {
    const entries = await sitemap();
    const urls = new Set(entries.map((entry) => entry.url));
    const city = mockCities.find((item) => item.active);
    assert.ok(city, "expected an active city in mock data");
    assert.ok(urls.has(new URL(`/stores/${city.slug}/`, siteUrl).href), "city route missing");
    for (const store of mockStores.filter((item) => item.active)) {
      const url = new URL(`/stores/${city.slug}/${store.slug}/`, siteUrl).href;
      assert.ok(urls.has(url), `sitemap must include ${url}`);
    }
  });

  test("excludes legal and private routes", async () => {
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);
    for (const path of LEGAL_PATHS) {
      const url = new URL(path, siteUrl).href;
      assert.ok(!urls.includes(url), `sitemap must exclude ${url}`);
    }
    for (const url of urls) {
      assert.ok(!url.includes("/api/"), `sitemap must not expose API routes: ${url}`);
      assert.ok(!url.includes("/_next/"), `sitemap must not expose internal routes: ${url}`);
    }
  });

  test("every sitemap URL stays on the site origin", async () => {
    const entries = await sitemap();
    for (const entry of entries) {
      assert.equal(new URL(entry.url).origin, siteUrl.origin, `origin for ${entry.url}`);
    }
  });
});

describe("robots", () => {
  test("allows public crawling and disallows private paths", () => {
    const result = robots();
    const rules = result.rules as Array<{
      userAgent?: string | string[];
      allow?: string | string[];
      disallow?: string | string[];
    }>;
    const starRule = rules.find(
      (rule) => typeof rule.userAgent === "string" && rule.userAgent === "*",
    );
    assert.ok(starRule, "robots must define a userAgent: * rule");
    assert.ok(starRule.allow?.includes("/"), "robots must allow /");
    for (const privatePath of ["/api/", "/admin/", "/preview/", "/directus/", "/_next/"]) {
      assert.ok(starRule.disallow?.includes(privatePath), `robots must disallow ${privatePath}`);
    }
  });

  test("declares the sitemap on the site origin", () => {
    const result = robots();
    assert.equal(result.sitemap, new URL("/sitemap.xml", siteUrl).href);
  });
});
