import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { Metadata } from "next";
import { NextRequest } from "next/server";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { CANONICAL_BRAND_SLUGS } from "@/lib/constants/brands";
import {
  siteUrl,
  createPageMetadata,
  DEFAULT_OG_IMAGE_ALT,
  DEFAULT_OG_IMAGE_HEIGHT,
  DEFAULT_OG_IMAGE_PATH,
  DEFAULT_OG_IMAGE_WIDTH,
} from "@/lib/seo/metadata";
import { mockCities, mockStores } from "@/lib/data/mock-data";
import { proxy } from "@/proxy";
import * as amperPage from "@/app/amper/page";
import * as ventilPage from "@/app/ventil/page";
import * as metizMarketPage from "@/app/metiz-market/page";
import * as miskaPage from "@/app/miska/page";
import { generateMetadata as generateCityMetadata } from "@/app/stores/[city]/page";
import * as privacyPage from "@/app/politika-konfidencialnosti/page";
import * as consentPage from "@/app/soglasie-na-obrabotku-dannyh/page";
import * as homePage from "@/app/page";
import * as storesPage from "@/app/stores/page";
import * as promotionsPage from "@/app/akcii/page";
import * as bonusPage from "@/app/bonus/page";
import * as vacanciesPage from "@/app/vakansii/page";
import * as aboutPage from "@/app/o-kompanii/page";
import * as contactsPage from "@/app/kontakty/page";
import * as faqPage from "@/app/faq/page";
import { generateMetadata as generateCityMetadata } from "@/app/stores/[city]/page";
import { generateMetadata as generateStoreMetadata } from "@/app/stores/[city]/[store]/page";

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

const INDEXABLE_STATIC_PAGES = [
  { module: homePage, path: "/" },
  { module: storesPage, path: "/stores/" },
  { module: promotionsPage, path: "/akcii/" },
  { module: bonusPage, path: "/bonus/" },
  { module: vacanciesPage, path: "/vakansii/" },
  { module: aboutPage, path: "/o-kompanii/" },
  { module: contactsPage, path: "/kontakty/" },
  { module: faqPage, path: "/faq/" },
  ...BRAND_PAGES,
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
  test("every static indexable page exposes one canonical trailing-slash URL", () => {
    const canonicalUrls = new Set<string>();
    for (const { module, path } of INDEXABLE_STATIC_PAGES) {
      const href = canonicalHref(module.metadata);
      assert.equal(href, new URL(path, siteUrl).href, `canonical for ${path}`);
      assert.equal(robotsFlags(module.metadata).index, true, `index for ${path}`);
      assert.equal(robotsFlags(module.metadata).follow, true, `follow for ${path}`);
      assert.ok(module.metadata.title, `title for ${path}`);
      assert.ok(module.metadata.description, `description for ${path}`);
      assert.ok(!canonicalUrls.has(href), `canonical ${href} must belong to only one public page`);
      canonicalUrls.add(href);
    }
  });

  test("dynamic city and store pages canonicalize their resolved content routes", async () => {
    for (const city of mockCities.filter((item) => item.active)) {
      const cityMetadata = await generateCityMetadata({ params: Promise.resolve({ city: city.slug }) });
      assert.equal(canonicalHref(cityMetadata), new URL(`/stores/${city.slug}/`, siteUrl).href);
      assert.equal(robotsFlags(cityMetadata).index, true);
      assert.equal(robotsFlags(cityMetadata).follow, true);

      for (const store of mockStores.filter((item) => item.active && item.city_id === city.id)) {
        const storeMetadata = await generateStoreMetadata({
          params: Promise.resolve({ city: city.slug, store: store.slug }),
        });
        assert.equal(
          canonicalHref(storeMetadata),
          new URL(`/stores/${city.slug}/${store.slug}/`, siteUrl).href,
        );
        assert.equal(robotsFlags(storeMetadata).index, true);
        assert.equal(robotsFlags(storeMetadata).follow, true);
      }
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

describe("default Open Graph image", () => {
  test("createPageMetadata references the shared image with alt text on every page", () => {
    // The root opengraph-image.png file convention only applies to the root
    // segment; child segments that define their own openGraph metadata do not
    // inherit it, so the shared image must be attached explicitly.
    const metadata = createPageMetadata({ title: "Title", description: "Description", path: "/faq/" });
    const images = metadata.openGraph?.images;
    assert.ok(Array.isArray(images), "openGraph.images must be an array");
    assert.equal(images.length, 1, "exactly one default og:image must be emitted");
    const image = images[0] as { url?: unknown; alt?: unknown; width?: unknown; height?: unknown; type?: unknown };
    assert.equal(image.url, DEFAULT_OG_IMAGE_PATH);
    assert.equal(image.alt, DEFAULT_OG_IMAGE_ALT);
    assert.equal(image.width, DEFAULT_OG_IMAGE_WIDTH);
    assert.equal(image.height, DEFAULT_OG_IMAGE_HEIGHT);
    assert.equal(image.type, "image/png");
  });

  test("the shared Open Graph image is a valid local PNG asset", () => {
    const imagePath = path.join(process.cwd(), "app", DEFAULT_OG_IMAGE_PATH.slice(1));
    assert.ok(existsSync(imagePath), `missing Open Graph image at ${DEFAULT_OG_IMAGE_PATH}`);
    const signature = readFileSync(imagePath).subarray(0, 8);
    assert.deepEqual(signature, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "Open Graph image must be PNG");
  });
});

describe("trailing-slash proxy", () => {
  const runProxy = (path: string) => proxy(new NextRequest(new URL(path, siteUrl).href));

  test("every extensionless public path redirects once with 308 to its canonical URL", () => {
    const dynamicPaths = mockCities.filter((item) => item.active).flatMap((city) => [
      `/stores/${city.slug}/`,
      ...mockStores
        .filter((store) => store.active && store.city_id === city.id)
        .map((store) => `/stores/${city.slug}/${store.slug}/`),
    ]);
    const canonicalPaths = [...INDEXABLE_STATIC_PAGES.map(({ path }) => path), ...LEGAL_PATHS, ...dynamicPaths];

    for (const canonicalPath of canonicalPaths) {
      if (canonicalPath === "/") continue;
      const path = canonicalPath.slice(0, -1);
      const response = runProxy(path);
      assert.equal(response.status, 308, `${path} must return 308`);
      const location = response.headers.get("location");
      assert.ok(location, `${path} must set a Location header`);
      assert.equal(new URL(location, siteUrl).href, new URL(canonicalPath, siteUrl).href, `${path} redirect target`);
      assert.notEqual(runProxy(new URL(location).pathname).status, 308, `${path} must redirect only once`);
    }
  });

  test("canonical, api, and asset URLs pass through without a redirect loop", () => {
    for (const path of ["/", "/amper/", "/kontakty/", "/api/health", "/opengraph-image.png"]) {
      const response = runProxy(path);
      assert.notEqual(response.status, 308, `${path} must not be redirected again`);
    }
  });
});

describe("public origin normalization", () => {
  test("canonical metadata always uses the configured HTTPS non-www origin", () => {
    assert.equal(siteUrl.protocol, "https:");
    assert.ok(!siteUrl.hostname.startsWith("www."));
    for (const { module, path } of INDEXABLE_STATIC_PAGES) {
      assert.equal(new URL(canonicalHref(module.metadata)).origin, siteUrl.origin, `origin for ${path}`);
    }
  });

  test("the edge redirects www to the same canonical origin", () => {
    const caddyfile = readFileSync(path.join(process.cwd(), "Caddyfile"), "utf8");
    assert.match(caddyfile, /www\.amurskmarket\.ru\s*\{/);
    assert.match(caddyfile, /redir\s+https:\/\/amurskmarket\.ru\{uri\}\s+permanent/);
  });
});

describe("city page structured data", () => {
  test("Amursk hub has its own canonical metadata", async () => {
    const metadata = await generateCityMetadata({ params: Promise.resolve({ city: "amursk" }) });
    assert.equal(canonicalHref(metadata), new URL("/stores/amursk/", siteUrl).href);
    assert.match(String(metadata.title), /Ампер.*Вентиль.*Метиз Маркет.*Миска/);
    assert.match(String(metadata.description), /электротовары.*сантехника.*крепёж.*зоотовары/);
  });

  test("city page renders the LocalBusiness JSON-LD graph for its stores", () => {
    const source = readFileSync(path.join(process.cwd(), "app", "stores", "[city]", "page.tsx"), "utf8");
    assert.ok(source.includes("createStoresJsonLd"), "city page must build the store JSON-LD graph");
    assert.ok(source.includes("<JsonLd"), "city page must render a JsonLd script block");
  });
});
