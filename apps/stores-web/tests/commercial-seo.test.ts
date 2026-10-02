import assert from "node:assert/strict";
import { test } from "node:test";
import sitemap from "@/app/sitemap";
import { generateMetadata as promotionsMetadata } from "@/app/akcii/page";
import { generateMetadata as vacanciesMetadata } from "@/app/vakansii/page";
import { generateMetadata as faqMetadata } from "@/app/faq/page";
import { renderToStaticMarkup } from "react-dom/server";
import { AmperSeoCategoryPage } from "@/components/amper/AmperSeoCategoryPage";
import { VentilSeoCategoryPage } from "@/components/ventil/VentilSeoCategoryPage";
import { MetizSeoCategoryPage } from "@/components/metiz-market/MetizSeoCategoryPage";
import { MiskaSeoCategoryPage } from "@/components/miska/MiskaSeoCategoryPage";
import { AMPER_SEO_CATEGORIES } from "@/lib/amper/seo-categories";
import { VENTIL_SEO_CATEGORIES } from "@/lib/ventil/seo-categories";
import { METIZ_SEO_CATEGORIES } from "@/lib/metiz-market/seo-categories";
import { MISKA_SEO_CATEGORIES } from "@/lib/miska/seo-categories";
import { getCategories } from "@/lib/directus/categories";
import { mockBrands, mockCategories } from "@/lib/data/mock-data";
import { excludeMiskaOfflineCategories } from "@/lib/miska/web-catalog";

test("empty CMS listings are noindex and absent from the sitemap", async (t) => {
  const previousSource = process.env.CONTENT_SOURCE;
  const previousUrl = process.env.DIRECTUS_URL;
  process.env.CONTENT_SOURCE = "directus";
  process.env.DIRECTUS_URL = "https://cms-test.invalid";
  t.after(() => {
    if (previousSource === undefined) delete process.env.CONTENT_SOURCE;
    else process.env.CONTENT_SOURCE = previousSource;
    if (previousUrl === undefined) delete process.env.DIRECTUS_URL;
    else process.env.DIRECTUS_URL = previousUrl;
  });
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: [] }));
  const paths = (await sitemap()).map(({ url }) => new URL(url).pathname);
  assert.ok(!paths.some((path) => /^\/(amper|ventil|metiz-market|miska)\//.test(path)), "categories with no active brand must be omitted");
  for (const [path, metadata] of [
    ["/akcii/", await promotionsMetadata()],
    ["/vakansii/", await vacanciesMetadata()],
    ["/faq/", await faqMetadata()],
  ] as const) {
    assert.equal((metadata.robots as { index: boolean }).index, false);
    assert.ok(!paths.includes(path), `${path} is noindex and must not be in sitemap`);
  }
});

test("commercial item links render within the relevant product context and resolve to sitemap owners", async () => {
  const urls = new Set((await sitemap()).map(({ url }) => new URL(url).pathname));
  const groups = [
    ["amper", AMPER_SEO_CATEGORIES, AmperSeoCategoryPage],
    ["ventil", VENTIL_SEO_CATEGORIES, VentilSeoCategoryPage],
    ["metiz-market", METIZ_SEO_CATEGORIES, MetizSeoCategoryPage],
  ] as const;
  let edgeCount = 0;
  for (const [brand, categories, render] of groups) {
    for (const category of categories.filter((entry) => entry.items.some((item) => item.href))) {
      const markup = renderToStaticMarkup(await render({ category }));
      const overview = markup.split('id="category-overview"')[1].split('</section>')[0];
      for (const item of category.items) {
        if (!item.href) continue;
        edgeCount++;
        assert.ok(urls.has(item.href), `missing indexable destination ${item.href}`);
        assert.notEqual(item.href, `/${brand}/${category.slug}/`, "contextual link must not point to itself");
        const anchors = [...overview.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
        assert.ok(anchors.some(([, href, text]) => `${href.replace(/\/$/, "")}/` === item.href && text === item.title), `missing contextual link ${item.href}`);
      }
      assert.equal((markup.match(/<h1\b/g) ?? []).length, 1);
    }
  }
  assert.ok(edgeCount >= 4, "commercial selection paths must remain connected");
});

test("published guides have contextual backlinks from their commercial categories", async () => {
  const cases = [
    [AMPER_SEO_CATEGORIES, "avtomaty-i-uzo", AmperSeoCategoryPage, "/stati/avtomaticheskiy-vyklyuchatel-dlya-kvartiry/"],
    [VENTIL_SEO_CATEGORIES, "smesiteli", VentilSeoCategoryPage, "/stati/smesitel-dlya-kuhni-kak-vybrat/"],
    [MISKA_SEO_CATEGORIES, "napolniteli-i-tualety", MiskaSeoCategoryPage, "/stati/napolnitel-dlya-koshachego-tualeta-kak-vybrat/"],
  ] as const;

  for (const [categories, slug, render, href] of cases) {
    const category = categories.find((entry) => entry.slug === slug);
    assert.ok(category?.guide);
    const markup = renderToStaticMarkup(await render({ category } as never));
    assert.ok(markup.includes('href="' + href.replace(/\/$/, "")));
    assert.equal(category.guide.href, href);
  }
});

test("Metiz samorezy category links back to the supporting article", async () => {
  const category = METIZ_SEO_CATEGORIES.find((entry) => entry.slug === "samorezy");
  assert.ok(category?.guide);
  const markup = renderToStaticMarkup(await MetizSeoCategoryPage({ category }));
  assert.match(markup, /href="\/stati\/kak-vybrat-samorezy-dlya-remonta-i-montazha\/?"/);
  const urls = new Set((await sitemap()).map(({ url }) => new URL(url).pathname));
  assert.ok(urls.has(category.guide.href));
});

test("Miska web categories exclude antiparasitic products and static pages have no invented lastmod", async () => {
  assert.doesNotMatch(JSON.stringify(MISKA_SEO_CATEGORIES), /антипаразит|противопаразит|от блох|от клещ|antiparazit|antiparasit/i);
  for (const entry of await sitemap()) {
    const path = new URL(entry.url).pathname;
    if (!path.startsWith("/stati/") || path === "/stati/") {
      assert.equal(entry.lastModified, undefined, `no authoritative modification date for ${path}`);
    }
    assert.doesNotMatch(path, /antiparazit|antiparasit|bloh|klesh/i);
  }
});

test("public catalog excludes physical-store-only antiparasitic categories", async () => {
  assert.doesNotMatch(JSON.stringify(await getCategories()), /паразитарные средства|antiparasitic/i);
});

test("CMS catalog exclusion handles category descendants and preserves ordinary Miska categories", async (t) => {
  const miska = mockBrands.find((brand) => brand.slug === "miska")!;
  const base = mockCategories.find((category) => category.brand_id === miska.id)!;
  const categories = [
    { ...base, id: "child", parent_id: "offline", name: "Drops", slug: "drops" },
    { ...base, id: "offline", name: "Паразитарные средства", slug: "antiparasitic" },
    { ...base, id: "grandchild", parent_id: "child", name: "Example", slug: "example" },
    { ...base, id: "care", name: "Уход", slug: "uhod" },
  ];
  const ordinary = { ...base, id: "ordinary", name: "Treat sticks", slug: "treat-sticks" };
  assert.deepEqual(excludeMiskaOfflineCategories([ordinary], miska.id), [ordinary]);
  const unrelated = { ...categories[1], brand_id: "different-brand" };
  assert.deepEqual(excludeMiskaOfflineCategories([unrelated], miska.id), [unrelated]);
  const before = JSON.stringify(categories);
  assert.deepEqual(excludeMiskaOfflineCategories(categories, miska.id).map(({ id }) => id), ["care"]);
  assert.equal(JSON.stringify(categories), before, "source catalog must not be mutated");
  assert.deepEqual(excludeMiskaOfflineCategories([], miska.id), []);
  const previousSource = process.env.CONTENT_SOURCE;
  const previousUrl = process.env.DIRECTUS_URL;
  process.env.CONTENT_SOURCE = "directus";
  process.env.DIRECTUS_URL = "https://cms-test.invalid";
  t.after(() => {
    if (previousSource === undefined) delete process.env.CONTENT_SOURCE;
    else process.env.CONTENT_SOURCE = previousSource;
    if (previousUrl === undefined) delete process.env.DIRECTUS_URL;
    else process.env.DIRECTUS_URL = previousUrl;
  });
  t.mock.method(globalThis, "fetch", async (url: string) => Response.json({
    data: new URL(url).pathname.endsWith("/brands") ? mockBrands : categories,
  }));
  assert.deepEqual((await getCategories()).map(({ id }) => id), ["care"]);
});
