import type { MetadataRoute } from "next";
import { getBrands } from "@/lib/directus/brands";
import { getCities } from "@/lib/directus/cities";
import { getStores } from "@/lib/directus/stores";
import { siteUrl } from "@/lib/seo/metadata";

const staticPaths = ["/", "/stores/", "/akcii/", "/bonus/", "/vakansii/", "/o-kompanii/", "/kontakty/", "/faq/"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [brands, cities, stores] = await Promise.all([getBrands(), getCities(), getStores()]);
  const cityById = new Map(cities.map((city) => [city.id, city]));
  const entries: MetadataRoute.Sitemap = staticPaths.map((path) => ({
    url: new URL(path, siteUrl).href,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : 0.7,
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
  return entries;
}
