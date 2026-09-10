import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import type { Metadata } from "next";
import * as homePage from "@/app/page";
import * as akciiPage from "@/app/akcii/page";
import * as amperPage from "@/app/amper/page";
import * as bonusPage from "@/app/bonus/page";
import * as ventilPage from "@/app/ventil/page";
import * as faqPage from "@/app/faq/page";
import * as kontaktyPage from "@/app/kontakty/page";
import * as metizMarketPage from "@/app/metiz-market/page";
import * as miskaPage from "@/app/miska/page";
import * as oKompaniiPage from "@/app/o-kompanii/page";
import * as storesPage from "@/app/stores/page";
import * as vakansiiPage from "@/app/vakansii/page";
import { CANONICAL_BRAND_SLUGS } from "@/lib/constants/brands";
import { mockBrands, mockFaqs } from "@/lib/data/mock-data";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

const STATIC_PAGE_MODULES: Array<{ name: string; metadata: Metadata }> = [
  { name: "/", metadata: homePage.metadata },
  { name: "/akcii/", metadata: akciiPage.metadata },
  { name: "/amper/", metadata: amperPage.metadata },
  { name: "/bonus/", metadata: bonusPage.metadata },
  { name: "/faq/", metadata: faqPage.metadata },
  { name: "/kontakty/", metadata: kontaktyPage.metadata },
  { name: "/metiz-market/", metadata: metizMarketPage.metadata },
  { name: "/miska/", metadata: miskaPage.metadata },
  { name: "/o-kompanii/", metadata: oKompaniiPage.metadata },
  { name: "/stores/", metadata: storesPage.metadata },
  { name: "/vakansii/", metadata: vakansiiPage.metadata },
  { name: "/ventil/", metadata: ventilPage.metadata },
];

describe("local SEO content layer", () => {
  test("every canonical brand has a local-intent FAQ grounded in verified facts", () => {
    const activeFaqs = mockFaqs.filter((faq) => faq.active);
    for (const slug of CANONICAL_BRAND_SLUGS) {
      const brand = mockBrands.find((item) => item.slug === slug);
      assert.ok(brand, `mock data must include brand ${slug}`);
      const faq = activeFaqs.find((item) => item.brand_id === brand.id);
      assert.ok(faq, `expected a local-intent FAQ for brand ${slug}`);
      assert.match(faq.question, /Амурске\?$/, `question for ${slug} must be a local-intent question`);
      assert.ok(
        faq.question.toLowerCase().includes(brand.name.toLowerCase()) || faq.answer.includes(brand.name),
        `FAQ for ${slug} must name the brand`,
      );
      assert.ok(
        faq.answer.includes("проспекте Победы, 16"),
        `FAQ answer for ${slug} must use only the verified address`,
      );
    }
  });

  test("general FAQs stay separate from brand-scoped FAQs", () => {
    const generalFaqs = mockFaqs.filter((faq) => !faq.brand_id);
    assert.ok(generalFaqs.length > 0, "expected general FAQs for the home page");
    for (const faq of generalFaqs) {
      assert.ok(!faq.answer.includes("проспекте Победы"), "general FAQ answers must not invent store facts");
    }
  });

  test("static page metadata titles and descriptions are unique", () => {
    const titles = STATIC_PAGE_MODULES.map((page) => page.metadata.title);
    const descriptions = STATIC_PAGE_MODULES.map((page) => page.metadata.description);
    assert.equal(new Set(titles).size, titles.length, "duplicate metadata titles across static pages");
    assert.equal(
      new Set(descriptions).size,
      descriptions.length,
      "duplicate metadata descriptions across static pages",
    );
  });

  test("store pages link back to their brand landing page", () => {
    const source = readFileSync(
      join(projectRoot, "app", "stores", "[city]", "[store]", "page.tsx"),
      "utf8",
    );
    assert.ok(
      source.includes("href={`/${brand.slug}/`}"),
      "store page must link to the brand landing route",
    );
  });
});
