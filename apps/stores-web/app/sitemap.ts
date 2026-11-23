import type { MetadataRoute } from "next";
import { CATALOG_STORES, catalogIndexable, displayPrice, type CatalogStore } from "@/lib/store-catalog/core";
import { loadCatalog } from "@/lib/store-catalog/server";
import { AMPER_SEO_CATEGORY_PATHS } from "@/lib/amper/seo-categories";
import { VENTIL_SEO_CATEGORY_PATHS } from "@/lib/ventil/seo-categories";
import { METIZ_SEO_CATEGORY_PATHS } from "@/lib/metiz-market/seo-categories";
import { MISKA_SEO_CATEGORY_PATHS } from "@/lib/miska/seo-categories";
import { getBrands } from "@/lib/directus/brands";
import { getCities } from "@/lib/directus/cities";
import { getStores } from "@/lib/directus/stores";
import { siteUrl } from "@/lib/seo/metadata";

const staticPaths = [
  "/",
  "/stores/",
  "/akcii/",
  "/bonus/",
  "/vakansii/",
  "/o-kompanii/",
  "/kontakty/",
  "/faq/",
  ...AMPER_SEO_CATEGORY_PATHS,
  ...VENTIL_SEO_CATEGORY_PATHS,
  ...METIZ_SEO_CATEGORY_PATHS,
  ...MISKA_SEO_CATEGORY_PATHS,
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [brands, cities, stores] = await Promise.all([getBrands(), getCities(), getStores()]);
  const cityById = new Map(cities.map((city) => [city.id, city]));
  const entries: MetadataRoute.Sitemap = staticPaths.map((path) => ({
    url: new URL(path, siteUrl).href,
    changeFrequency: path === "/" || path.startsWith("/amper/") || path.startsWith("/ventil/") || path.startsWith("/metiz-market/") || path.startsWith("/miska/") ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path.startsWith("/amper/") || path.startsWith("/ventil/") || path.startsWith("/metiz-market/") || path.startsWith("/miska/") ? 0.8 : 0.7,
  }));

  for (const brand of brands.filter((item) => item.active)) {
    entries.push({ url: new URL(`/${brand.slug}/`, siteUrl).href, lastModified: brand.updated_at, changeFrequency: "weekly", priority: 0.8 });
  }
  for (const city of cities.filter((item) => item.active)) {
    entries.push({ url: new URL(`/stores/${city.slug}/`, siteUrl).href, lastModified: city.updated_at, changeFrequency: "weekly", priority: 0.8 });
  }
  for (const store of stores.filter((item) => item.active)) {
    const city = cityById.get(store.city_id);
    if (city) entries.push({ url: new URL(`/stores/${city.slug}/${store.slug}/`, siteUrl).href, lastModified: store.updated_at, changeFrequency: "weekly", priority: 0.9 });
  }
  // Only publish real, fresh, store-isolated 1C catalogs and priced product URLs.
  for (const store of Object.keys(CATALOG_STORES) as CatalogStore[]) {
    const snapshot = await loadCatalog(store);
    if (!snapshot || !catalogIndexable(snapshot)) continue;
    entries.push({ url: new URL("/catalog/" + store + "/", siteUrl).href, changeFrequency: "daily", priority: 0.8 });
    for (const product of snapshot.products.filter((item) => displayPrice(item) !== null).slice(0, 5000)) {
      entries.push({ url: new URL("/catalog/" + store + "/" + encodeURIComponent(product.id) + "/", siteUrl).href, changeFrequency: "daily", priority: 0.6 });
    }
  }
  return entries;
}
