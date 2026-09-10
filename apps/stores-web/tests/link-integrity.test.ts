import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import nextConfig from "@/next.config";
import { CANONICAL_BRAND_SLUGS } from "@/lib/constants/brands";
import { mockActualItems, mockCities, mockStores } from "@/lib/data/mock-data";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

const SOURCE_DIRS = ["app", "components", "lib"];

function listSourceFiles(dir: string, accumulated: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      listSourceFiles(fullPath, accumulated);
    } else if (/\.(?:ts|tsx)$/.test(entry)) {
      accumulated.push(fullPath);
    }
  }
  return accumulated;
}

function displayPath(filePath: string): string {
  return relative(projectRoot, filePath);
}

const sourceFiles = SOURCE_DIRS.flatMap((dir) => listSourceFiles(join(projectRoot, dir)));
assert.ok(sourceFiles.length > 0, "expected to scan app sources");

const sourceByFile = new Map(sourceFiles.map((file) => [file, readFileSync(file, "utf8")]));

function findAll(pattern: RegExp, text: string): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) matches.push(match);
  return matches;
}

// ---------------------------------------------------------------------------
// Route model
// ---------------------------------------------------------------------------

interface RouteModel {
  staticPaths: Set<string>;
  dynamicPatterns: RegExp[];
}

// Static pages derived from the app directory itself, so a moved or deleted
// page is detected even if the expected list below is not updated.
function deriveStaticPagesFromAppDir(): string[] {
  const appDir = join(projectRoot, "app");
  const pages: string[] = [];
  for (const file of listSourceFiles(appDir)) {
    if (!file.endsWith("page.tsx")) continue;
    const dir = dirname(relative(appDir, file));
    const segments = dir === "." ? [] : dir.split("/");
    if (segments[0] === "api") continue;
    if (segments.some((segment) => segment.startsWith("["))) continue;
    pages.push(`/${segments.join("/")}${segments.length ? "/" : ""}`);
  }
  return pages.sort();
}

const EXPECTED_STATIC_PAGES = [
  "/",
  "/akcii/",
  "/amper/",
  "/bonus/",
  "/faq/",
  "/kontakty/",
  "/metiz-market/",
  "/miska/",
  "/o-kompanii/",
  "/politika-konfidencialnosti/",
  "/soglasie-na-obrabotku-dannyh/",
  "/stores/",
  "/vakansii/",
  "/ventil/",
];

const citySlugs = new Set(mockCities.filter((city) => city.active).map((city) => city.slug));
const storeSlugsByCity = new Map<string, Set<string>>();
for (const store of mockStores.filter((item) => item.active)) {
  const city = mockCities.find((item) => item.id === store.city_id);
  if (!city) continue;
  const slugs = storeSlugsByCity.get(city.slug) ?? new Set<string>();
  slugs.add(store.slug);
  storeSlugsByCity.set(city.slug, slugs);
}

const routeModel: RouteModel = {
  staticPaths: new Set(EXPECTED_STATIC_PAGES),
  dynamicPatterns: [
    ...CANONICAL_BRAND_SLUGS.map((slug) => new RegExp(`^/${slug}/$`)),
    ...[...citySlugs].map((slug) => new RegExp(`^/stores/${slug}/$`)),
    ...[...storeSlugsByCity.entries()].flatMap(([citySlug, storeSlugs]) =>
      [...storeSlugs].map((storeSlug) => new RegExp(`^/stores/${citySlug}/${storeSlug}/$`)),
    ),
  ],
};

const INDEXABLE_PATHS = new Set([
  ...EXPECTED_STATIC_PAGES.filter(
    (path) => !["/politika-konfidencialnosti/", "/soglasie-na-obrabotku-dannyh/"].includes(path),
  ),
  ...CANONICAL_BRAND_SLUGS.map((slug) => `/${slug}/`),
  ...[...citySlugs].map((slug) => `/stores/${slug}/`),
  ...[...storeSlugsByCity.entries()].flatMap(([citySlug, storeSlugs]) =>
    [...storeSlugs].map((storeSlug) => `/stores/${citySlug}/${storeSlug}/`),
  ),
]);

function isKnownInternalPath(path: string): boolean {
  return routeModel.staticPaths.has(path) || routeModel.dynamicPatterns.some((pattern) => pattern.test(path));
}

// ---------------------------------------------------------------------------
// Link extraction
// ---------------------------------------------------------------------------

interface LinkRef {
  file: string;
  line: number;
  href: string;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

const HREF_LITERAL_PATTERN = /href=\{?["'`]([^"'`]+)["'`]\}?/g;

const ALLOWED_TEMPLATE_HREFS = new Set([
  // Brand slugs interpolated from canonical brand data.
  "/${brand.slug}/",
  "/${store.slug}/",
  "/${slug}/",
  "/${card.slug}/",
  // City/store slugs interpolated from content data.
  "/stores/${city.slug}/",
  "/stores/${city.slug}/${store.slug}/",
]);

const internalLinks: LinkRef[] = [];
const anchorLinks: LinkRef[] = [];
const templateLinks: LinkRef[] = [];

for (const [file, text] of sourceByFile) {
  for (const match of findAll(HREF_LITERAL_PATTERN, text)) {
    const href = match[1];
    const ref: LinkRef = { file: displayPath(file), line: lineOf(text, match.index), href };
    if (href.startsWith("#")) {
      anchorLinks.push(ref);
    } else if (href.startsWith("/")) {
      if (href.includes("${")) templateLinks.push(ref);
      else internalLinks.push(ref);
    }
  }
}

assert.ok(internalLinks.length > 0, "expected literal internal links in sources");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("route registry matches the app structure", () => {
  test("static pages derived from app/ match the expected public route set", () => {
    const derived = deriveStaticPagesFromAppDir();
    assert.deepEqual(derived, [...EXPECTED_STATIC_PAGES].sort());
  });

  test("required sections are covered by at least one internal link", () => {
    const linked = new Set(internalLinks.map((link) => link.href));
    for (const path of EXPECTED_STATIC_PAGES) {
      if (path === "/") continue;
      assert.ok(linked.has(path), `expected at least one internal link to ${path}`);
    }
    for (const slug of CANONICAL_BRAND_SLUGS) {
      assert.ok(linked.has(`/${slug}/`), `expected at least one internal link to /${slug}/`);
    }
  });

  test("every indexable route has a contextual incoming link outside global navigation", () => {
    const contextualTargets = new Set(
      internalLinks
        .filter((link) => !link.file.startsWith("components/layout/"))
        .map((link) => link.href),
    );

    // Expand the content-driven route templates against the same active data
    // used to construct the route registry.
    for (const slug of CANONICAL_BRAND_SLUGS) contextualTargets.add(`/${slug}/`);
    for (const citySlug of citySlugs) contextualTargets.add(`/stores/${citySlug}/`);
    for (const [citySlug, storeSlugs] of storeSlugsByCity) {
      for (const storeSlug of storeSlugs) contextualTargets.add(`/stores/${citySlug}/${storeSlug}/`);
    }
    for (const item of mockActualItems.filter((entry) => entry.active && entry.buttonUrl)) {
      contextualTargets.add(item.buttonUrl!);
    }

    // The root is the crawl entry point, not an orphan candidate.
    for (const path of [...INDEXABLE_PATHS].filter((item) => item !== "/")) {
      assert.ok(contextualTargets.has(path), `indexable route ${path} has no contextual incoming link`);
    }
  });

  test("brand pages cross-link the city, contacts, bonus program, and brand details", () => {
    const brandContact = sourceByFile.get(join(projectRoot, "components/stores/BrandStoreContact.tsx")) ?? "";
    const contacts = sourceByFile.get(join(projectRoot, "components/contacts/ContactStoreGrid.tsx")) ?? "";
    const bonus = sourceByFile.get(join(projectRoot, "app/bonus/page.tsx")) ?? "";

    assert.match(brandContact, /href=\{`\/stores\/\$\{city\.slug\}\/`\}/);
    assert.match(brandContact, /\u0412\u0441\u0435 \u043c\u0430\u0433\u0430\u0437\u0438\u043d\u044b \u0432 \{city\.name\}/);
    assert.match(brandContact, /\u041a\u043e\u043d\u0442\u0430\u043a\u0442\u044b \u0438 \u0440\u0435\u0436\u0438\u043c \u0440\u0430\u0431\u043eты/);
    assert.match(contacts, /href=\{`\/\$\{brand\.slug\}\/`\}/);
    assert.match(contacts, /\u0410\u0441\u0441\u043e\u0440\u0442\u0438\u043c\u0435\u043d\u0442 \u043c\u0430\u0433\u0430\u0437\u0438\u043d\u0430/);
    assert.match(bonus, /program\.participating_brands\.includes\(brand\.id\)/);
    assert.match(bonus, /href=\{`\/\$\{brand\.slug\}\/`\}/);
  });
});

describe("internal link literals", () => {
  test("every literal internal href resolves to a known route", () => {
    for (const link of internalLinks) {
      assert.ok(
        isKnownInternalPath(link.href),
        `${link.file}:${link.line} points to unknown route ${link.href}`,
      );
    }
  });

  test("internal hrefs use a single trailing slash and no duplicate slashes", () => {
    for (const link of internalLinks) {
      assert.ok(!link.href.slice(1).includes("//"), `${link.file}:${link.line} duplicate slash in ${link.href}`);
      if (link.href !== "/") {
        assert.ok(link.href.endsWith("/"), `${link.file}:${link.line} missing trailing slash in ${link.href}`);
      }
    }
  });

  test("dynamic template hrefs match an approved route pattern", () => {
    assert.ok(templateLinks.length > 0, "expected dynamic internal links in sources");
    for (const link of templateLinks) {
      assert.ok(
        ALLOWED_TEMPLATE_HREFS.has(link.href),
        `${link.file}:${link.line} uses unapproved dynamic href pattern ${link.href}`,
      );
    }
  });

  test("in-page anchors reference ids that exist in sources", () => {
    const ids = new Set<string>();
    for (const text of sourceByFile.values()) {
      for (const match of findAll(/id=["']([^"']+)["']/g, text)) ids.add(match[1]);
    }
    for (const link of anchorLinks) {
      assert.ok(ids.has(link.href.slice(1)), `${link.file}:${link.line} anchors to missing id ${link.href}`);
    }
  });

  test("content-driven button urls resolve to known routes", () => {
    for (const item of mockActualItems.filter((entry) => entry.active && entry.buttonUrl)) {
      assert.ok(
        isKnownInternalPath(item.buttonUrl!),
        `actual item ${item.id} has unroutable buttonUrl ${item.buttonUrl}`,
      );
    }
  });
});

describe("telephone links", () => {
  const TEL_TEMPLATE_PATTERN = /`tel:\$\{([^}]+)\}`/g;
  const NORMALIZED_EXPR_PATTERN = /(?:^|\.)replace\(\/\[\^\\d\+\]\/g,\s*""\)$/;
  const NORMALIZED_VARIABLES = new Set(["telephoneHref", "phoneHref", "formatPhone(store.telephone)"]);

  test("every tel: template uses a normalized phone value", () => {
    let found = 0;
    for (const [file, text] of sourceByFile) {
      for (const match of findAll(TEL_TEMPLATE_PATTERN, text)) {
        found += 1;
        const expression = match[1].trim();
        assert.ok(
          NORMALIZED_EXPR_PATTERN.test(expression) || NORMALIZED_VARIABLES.has(expression),
          `${displayPath(file)} builds tel: link from unnormalized value: tel:\${${expression}}`,
        );
      }
    }
    assert.ok(found > 0, "expected tel: links in sources");
  });

  test("store telephones produce valid tel: uris", () => {
    for (const store of mockStores) {
      if (!store.telephone) continue;
      const telHref = `tel:${store.telephone.replace(/[^\d+]/g, "")}`;
      assert.ok(/^tel:\+\d{11}$/.test(telHref), `store ${store.slug} telephone ${store.telephone} yields ${telHref}`);
    }
  });
});

describe("yandex map links", () => {
  test("store map links are well-formed yandex maps urls", () => {
    let found = 0;
    for (const store of mockStores) {
      for (const link of store.map_links) {
        if (!link.url) continue;
        found += 1;
        const url = new URL(link.url);
        assert.equal(url.protocol, "https:", `store ${store.slug} map link must use https`);
        assert.equal(url.hostname, "yandex.ru", `store ${store.slug} map link must point to yandex.ru`);
        assert.ok(url.pathname.startsWith("/maps"), `store ${store.slug} map link must target /maps`);
        assert.ok(url.searchParams.get("text")?.trim(), `store ${store.slug} map link must include a non-empty text query`);
      }
    }
    assert.ok(found > 0, "expected map links in mock content");
  });
});

describe("redirects", () => {
  test("no redirect loops are configured", async () => {
    assert.equal(nextConfig.trailingSlash, true, "trailingSlash must stay enabled for canonical urls");
    const redirects = nextConfig.redirects;
    if (typeof redirects !== "function") {
      assert.ok(!redirects, "unexpected static redirects configuration");
      return;
    }
    const entries = await redirects();
    const normalize = (value: string) => {
      const withSlash = value.endsWith("/") || value.includes(":") ? value : `${value}/`;
      return withSlash;
    };
    for (const entry of entries) {
      assert.notEqual(normalize(entry.source), normalize(entry.destination), `redirect loop at ${entry.source}`);
    }
  });
});
