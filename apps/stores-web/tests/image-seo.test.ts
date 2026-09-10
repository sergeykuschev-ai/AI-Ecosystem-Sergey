import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, test } from "node:test";
import { ActualSlider } from "@/components/actual/ActualSlider";
import { BrandActualList } from "@/components/brand/BrandActualList";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { mockActualItems, mockBrands } from "@/lib/data/mock-data";

function imageTags(markup: string): string[] {
  return markup.match(/<img[^>]*>/g) ?? [];
}

describe("image alternative text", () => {
  test("brand logos use concise brand-identifying alt text", () => {
    for (const brand of mockBrands.filter((item) => item.logo)) {
      const markup = renderToStaticMarkup(h(BrandLogo, { brand }));
      const images = imageTags(markup);
      assert.equal(images.length, 1, `${brand.name} must render one logo`);
      assert.match(images[0], new RegExp(`alt="Логотип магазина ${brand.name}"`));
    }
  });

  test("content images expose their editorial alt without SEO keyword duplication", () => {
    const items = mockActualItems.filter((item) => item.image);
    const markup = renderToStaticMarkup(h(BrandActualList, { items }));
    const images = imageTags(markup);
    assert.equal(images.length, items.length);

    for (const item of items) {
      const expectedAlt = item.imageAlt ?? item.title;
      assert.ok(expectedAlt.trim(), `missing alt for ${item.id}`);
      assert.equal(
        images.filter((image) => image.includes(`alt="${expectedAlt}"`)).length,
        1,
        `alt for ${item.id} must occur exactly once`,
      );
    }
  });

  test("the analytics tracking pixel remains decorative", () => {
    const source = readFileSync(path.join(process.cwd(), "components/analytics/YandexMetrika.tsx"), "utf8");
    assert.match(source, /<img[\s\S]*?alt=""[\s\S]*?\/>/);
  });
});

describe("image layout stability", () => {
  test("responsive content images use the fill layout with a sizes hint", () => {
    const brands = mockBrands.map(({ id, slug, name, primary_color, secondary_color }) => ({
      id,
      slug,
      name,
      primary_color,
      secondary_color,
    }));
    const markup = renderToStaticMarkup(h(ActualSlider, { items: mockActualItems, brands }));

    for (const image of imageTags(markup)) {
      assert.match(image, /sizes="[^"]+"/);
      assert.match(image, /data-nimg="fill"/);
    }
  });

  test("every fill-image container reserves a stable aspect or fixed height", () => {
    const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    assert.match(css, /\.actual-slide__visual \{[^}]*aspect-ratio: 16 \/ 9;/);
    assert.match(css, /\.brand-actual-card__visual \{[^}]*aspect-ratio: 16 \/ 9;/);
    assert.match(css, /\.brand-actual-card__visual--portrait \{ aspect-ratio: 3 \/ 4; \}/);
    assert.match(css, /\.brand-logo \{[^}]*height: 7\.25rem;/);
  });
});
