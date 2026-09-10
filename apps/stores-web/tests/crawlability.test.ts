import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Header, primaryLinks } from "@/components/layout/Header";
import { StoreNavigationBar } from "@/components/layout/StoreNavigationBar";
import { StoreCard } from "@/components/stores/StoreCard";
import { mockBrands, mockCities, mockStores } from "@/lib/data/mock-data";

function hasHref(html: string, href: string): boolean {
  const withoutTrailingSlash = href === "/" ? href : href.replace(/\/$/, "");
  return html.includes(`href="${href}"`) || html.includes(`href="${withoutTrailingSlash}"`);
}

describe("server-rendered crawlability", () => {
  test("city store cards expose their address, phone, and detail link without client JavaScript", () => {
    const store = mockStores[0];
    const brand = mockBrands.find((item) => item.id === store.brand_id);
    const city = mockCities.find((item) => item.id === store.city_id);
    assert.ok(brand);
    assert.ok(city);

    const html = renderToStaticMarkup(createElement(StoreCard, { store, brand, city }));
    const telephoneHref = store.telephone?.replace(/[^\d+]/g, "");

    assert.ok(store.address && html.includes(store.address), "visible store address must be in SSR HTML");
    assert.ok(telephoneHref && html.includes(`href="tel:${telephoneHref}"`), "phone link must be in SSR HTML");
    assert.ok(
      hasHref(html, `/stores/${city.slug}/${store.slug}/`),
      "store detail link must be in SSR HTML",
    );
  });

  test("desktop and store navigation links are present in SSR HTML", () => {
    const html = [Header, StoreNavigationBar]
      .map((Component) => renderToStaticMarkup(createElement(Component)))
      .join("");

    for (const link of primaryLinks) {
      assert.ok(hasHref(html, link.href), `${link.href} must be server-rendered`);
    }
    for (const slug of ["amper", "ventil", "metiz-market", "miska"]) {
      assert.ok(hasHref(html, `/${slug}/`), `/${slug}/ must be server-rendered`);
    }
  });
});
