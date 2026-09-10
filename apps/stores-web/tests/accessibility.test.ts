import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, test } from "node:test";
import { ActualSlider } from "@/components/actual/ActualSlider";
import { BrandCard } from "@/components/brand/BrandCard";
import { FAQItem } from "@/components/faq/FAQItem";
import { StaticPage } from "@/components/content/StaticPage";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileNavigation } from "@/components/layout/MobileNavigation";
import { StoreNavigationBar } from "@/components/layout/StoreNavigationBar";
import { HomeStoreCard } from "@/components/stores/HomeStoreCard";
import { mockActualItems, mockBrands, mockCities, mockStores } from "@/lib/data/mock-data";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

function readSource(relativePath: string): string {
  return readFileSync(join(projectRoot, ...relativePath.split("/")), "utf8");
}

function count(markup: string, pattern: RegExp): number {
  return (markup.match(pattern) ?? []).length;
}

// WCAG relative luminance and contrast ratio (sRGB).
function channelLuminance(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const red = channelLuminance(Number.parseInt(hex.slice(1, 3), 16));
  const green = channelLuminance(Number.parseInt(hex.slice(3, 5), 16));
  const blue = channelLuminance(Number.parseInt(hex.slice(5, 7), 16));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("landmarks and navigation semantics", () => {
  test("header exposes labelled desktop and mobile navigation landmarks", () => {
    const markup = renderToStaticMarkup(h(Header));
    assert.match(markup, /<header class="site-header">/);
    assert.match(markup, /<nav class="desktop-nav" aria-label="Основная навигация">/);
    assert.match(markup, /<nav aria-label="Мобильная навигация">/);
    const siteName = markup.match(/<a class="site-name"[^>]*>/)?.[0] ?? "";
    assert.match(siteName, /href="\/"/);
    assert.match(siteName, /aria-label="На главную"/);
  });

  test("mobile menu summary uses its visible text and keeps native expanded state", () => {
    const markup = renderToStaticMarkup(h(MobileNavigation, { links: [{ label: "Контакты", href: "/kontakty/", event: null }] }));
    assert.match(markup, /<summary>Меню<\/summary>/);
    assert.doesNotMatch(markup, /<summary[^>]*aria-label=/);
  });

  test("desktop and mobile navigation resolve to identical canonical targets", () => {
    const markup = renderToStaticMarkup(h(Header));
    const desktop = markup.match(/<nav class="desktop-nav"[^>]*>(.*?)<\/nav>/)?.[1] ?? "";
    const mobile = markup.match(/<nav aria-label="Мобильная навигация">(.*?)<\/nav>/)?.[1] ?? "";
    const hrefs = (navigation: string) => [...navigation.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(hrefs(mobile), hrefs(desktop));
  });

  test("store navigation bar is a labelled nav list with one link per brand", () => {
    const markup = renderToStaticMarkup(h(StoreNavigationBar));
    assert.match(markup, /<nav class="store-navigation" aria-label="Навигация по магазинам">/);
    assert.equal(count(markup, /class="store-navigation__link"/g), 4);
  });

  test("footer navigation groups have distinct accessible labels", () => {
    const markup = renderToStaticMarkup(h(Footer));
    assert.match(markup, /<footer class="site-footer">/);
    for (const label of ["Магазины", "Покупателям", "Информация"]) {
      assert.match(markup, new RegExp(`<nav aria-label="${label}">`));
    }
  });

  test("static pages render a single h1 inside main", () => {
    const markup = renderToStaticMarkup(h(StaticPage, { title: "Контакты", intro: "Текст." }, h("p", null, "Содержимое")));
    assert.match(markup, /<main>/);
    assert.equal(count(markup, /<h1[ >]/g), 1);
    assert.match(markup, /<h1>Контакты<\/h1>/);
  });
});

describe("accordion and card semantics", () => {
  test("faq item uses native details/summary with a decorative indicator", () => {
    const markup = renderToStaticMarkup(
      h(FAQItem, { item: { id: "faq-1", question: "Вопрос?", answer: "Первая строка\n\nВторая строка", brand_id: null, city_id: null, store_id: null, category_id: null, sort_order: 1, active: true } }),
    );
    assert.match(markup, /<details class="faq-item">/);
    assert.match(markup, /<summary><span>Вопрос\?<\/span><span class="faq-item__indicator" aria-hidden="true">/);
    assert.equal(count(markup, /<p>/g), 2);
  });

  test("brand card keeps its trailing arrow decorative", () => {
    const markup = renderToStaticMarkup(h(BrandCard, { brand: mockBrands[0] }));
    assert.match(markup, /<h3>Ампер<\/h3>/);
    assert.match(markup, /alt="Логотип магазина Ампер"/);
    assert.match(markup, /<span aria-hidden="true">→<\/span>/);
  });

  test("home store card exposes reachable buttons with explicit types", () => {
    const storeWithoutPhone = { ...mockStores[0], telephone: null, map_links: [] };
    const markup = renderToStaticMarkup(
      h(HomeStoreCard, { store: storeWithoutPhone, brand: mockBrands[0], city: mockCities[0] }),
    );
    assert.equal(count(markup, /<button[^>]*type="button"/g), 2);
    assert.doesNotMatch(markup, /<button(?![^>]*type=)/);
    assert.match(markup, /Телефон будет добавлен/);
  });
});

describe("actual slider carousel accessibility", () => {
  const brands = mockBrands.map(({ id, slug, name, primary_color, secondary_color }) => ({ id, slug, name, primary_color, secondary_color }));
  const markup = renderToStaticMarkup(h(ActualSlider, { items: mockActualItems, brands }));

  test("keyboard viewport is a named group, not a bare focusable div", () => {
    assert.match(markup, /class="actual-slider__viewport" role="group" tabindex="0"/);
  });

  test("arrow controls are a labelled group with named buttons", () => {
    assert.match(markup, /class="actual-slider__arrows" role="group" aria-label="Управление слайдером"/);
    assert.match(markup, /aria-label="Предыдущий слайд"/);
    assert.match(markup, /aria-label="Следующий слайд"/);
  });

  test("slides expose group/slide roles and dot buttons expose the current position", () => {
    assert.equal(count(markup, /role="group" aria-roledescription="slide"/g), mockActualItems.length);
    assert.match(markup, /aria-label="1 из \d+"/);
    assert.equal(count(markup, /aria-current="true"/g), 1);
  });

  test("every slide image has alternative text", () => {
    const images = markup.match(/<img[^>]*>/g) ?? [];
    assert.ok(images.length > 0);
    for (const image of images) {
      assert.match(image, /alt="[^"]+"/, `image must have non-empty alt: ${image}`);
      assert.doesNotMatch(image, /alt=""/);
    }
  });

  test("brand slides carry their brand for the contrast-safe text palette", () => {
    assert.match(markup, /data-slide-index="3" data-brand="amper"/);
  });
});

describe("skip link and breadcrumb regression guards", () => {
  test("skip link target is focusable so keyboard focus moves to content", () => {
    const layoutSource = readSource("app/layout.tsx");
    assert.match(layoutSource, /className="skip-link" href="#main-content"/);
    assert.match(layoutSource, /<div id="main-content" tabIndex=\{-1\}>/);
    const cssSource = readSource("app/globals.css");
    assert.match(cssSource, /\.skip-link:focus/);
  });

  test("breadcrumb separators are hidden from assistive technology", () => {
    const markup = renderToStaticMarkup(h(Breadcrumbs, { trail: [
      { name: "Главная", path: "/" },
      { name: "Магазины Амурска", path: "/stores/amursk/" },
      { name: "Ампер", path: "/stores/amursk/amper/" },
    ] }));
    assert.match(markup, /aria-label="Хлебные крошки"/);
    const separators = markup.match(/<span[^>]*>\/<\/span>/g) ?? [];
    assert.equal(separators.length, 2);
    for (const separator of separators) {
      assert.match(separator, /aria-hidden="true"/, `separator must be aria-hidden: ${separator}`);
    }
    assert.match(markup, /aria-current="page">Ампер<\/span>/);
  });
});

describe("actual slide accent text contrast", () => {
  const cssSource = readSource("app/globals.css");

  function accentVariableValue(selector: string, variable: string): string {
    const block = cssSource.match(new RegExp(`${selector.replace(/[/.[\]"]/g, "\\$&")} \\{([^}]*)\\}`));
    assert.ok(block, `missing CSS block for ${selector}`);
    const value = block[1].match(new RegExp(`${variable}: (#[0-9a-f]{6})`));
    assert.ok(value, `missing ${variable} in ${selector}`);
    return value[1];
  }

  test("rules use the on-accent and accent-text variables instead of hardcoded white", () => {
    assert.match(cssSource, /\.actual-slide__type \{ color: var\(--slide-on-accent\);/);
    assert.match(cssSource, /\.actual-slide__button \{[^}]*color: var\(--slide-on-accent\);/);
    assert.match(cssSource, /\.actual-slide__badge \{ color: var\(--slide-accent-text\);/);
  });

  test("amper's light brand yellow gets a contrast-safe ink that passes WCAG AA on accent and on white", () => {
    const ink = accentVariableValue('.actual-slide[data-brand="amper"]', "--slide-on-accent");
    assert.equal(ink, accentVariableValue('.actual-slide[data-brand="amper"]', "--slide-accent-text"));
    assert.ok(contrastRatio(ink, "#f4c300") >= 4.5, `ink ${ink} on #f4c300 must be >= 4.5:1`);
    assert.ok(contrastRatio(ink, "#ffffff") >= 4.5, `ink ${ink} on #ffffff must be >= 4.5:1`);
    assert.ok(contrastRatio("#ffffff", "#f4c300") < 4.5, "sanity: white on amper yellow really fails AA");
  });
});
