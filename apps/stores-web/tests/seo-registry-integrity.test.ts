import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import sitemap from "@/app/sitemap";
import { AMPER_SEO_CATEGORIES, AMPER_SEO_CATEGORY_PATHS } from "@/lib/amper/seo-categories";
import { METIZ_SEO_CATEGORIES, METIZ_SEO_CATEGORY_PATHS } from "@/lib/metiz-market/seo-categories";
import { MISKA_SEO_CATEGORIES, MISKA_SEO_CATEGORY_PATHS } from "@/lib/miska/seo-categories";
import { VENTIL_SEO_CATEGORIES, VENTIL_SEO_CATEGORY_PATHS } from "@/lib/ventil/seo-categories";
import { KEY_RECRAWL_PATHS } from "@/lib/seo/key-urls";
import { siteUrl } from "@/lib/seo/metadata";
import { SEO_RECRAWL_PATHS } from "@/lib/seo/recrawl-paths";

const groups = [
  ["amper", AMPER_SEO_CATEGORIES, AMPER_SEO_CATEGORY_PATHS],
  ["ventil", VENTIL_SEO_CATEGORIES, VENTIL_SEO_CATEGORY_PATHS],
  ["metiz-market", METIZ_SEO_CATEGORIES, METIZ_SEO_CATEGORY_PATHS],
  ["miska", MISKA_SEO_CATEGORIES, MISKA_SEO_CATEGORY_PATHS],
] as const;

const allCategoryPaths = groups.flatMap(([, , paths]) => [...paths]);

describe("SEO registry integrity", () => {
  test("category slugs and metadata stay unique", () => {
    const titles: string[] = [];
    const descriptions: string[] = [];
    const headings: string[] = [];
    for (const [brand, categories] of groups) {
      const slugs = categories.map((category) => category.slug);
      assert.equal(new Set(slugs).size, slugs.length, `${brand} category slugs must be unique`);
      for (const category of categories) {
        titles.push(category.metaTitle);
        descriptions.push(category.metaDescription);
        headings.push(category.h1);
      }
    }
    assert.equal(new Set(titles).size, titles.length, "SEO category titles must be unique");
    assert.equal(new Set(descriptions).size, descriptions.length, "SEO category descriptions must be unique");
    assert.equal(new Set(headings).size, headings.length, "SEO category H1 values must be unique");
  });

  test("brand landing pages derive category links from their registries", () => {
    for (const [brand] of groups) {
      const source = readFileSync(path.join(process.cwd(), "app", brand, "page.tsx"), "utf8");
      assert.ok(source.includes(`/${brand}/\${category.slug}/`), `${brand} must render registry-driven category links`);
    }
  });

  test("one shared re-crawl registry contains every key and category path exactly once", () => {
    const expected = [...KEY_RECRAWL_PATHS, ...allCategoryPaths];
    assert.deepEqual([...SEO_RECRAWL_PATHS], expected);
    assert.equal(new Set(SEO_RECRAWL_PATHS).size, SEO_RECRAWL_PATHS.length, "re-crawl paths must be unique");
  });

  test("every registered category is present in sitemap exactly once", async () => {
    const counts = new Map<string, number>();
    for (const entry of await sitemap()) counts.set(entry.url, (counts.get(entry.url) ?? 0) + 1);
    for (const categoryPath of allCategoryPaths) {
      const url = new URL(categoryPath, siteUrl).href;
      assert.equal(counts.get(url), 1, `sitemap must include ${url} exactly once`);
    }
  });
});
