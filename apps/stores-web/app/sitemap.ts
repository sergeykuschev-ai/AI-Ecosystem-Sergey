import type { MetadataRoute } from "next";
import { AMPER_SEO_CATEGORY_PATHS } from "@/lib/amper/seo-categories";
import { VENTIL_SEO_CATEGORY_PATHS } from "@/lib/ventil/seo-categories";
import { METIZ_SEO_CATEGORY_PATHS } from "@/lib/metiz-market/seo-categories";
import { MISKA_SEO_CATEGORY_PATHS } from "@/lib/miska/seo-categories";
import { getActualItemsByType } from "@/lib/directus/actual-items";
import { getFaqs } from "@/lib/directus/faqs";
import { isCanonicalBrandSlug } from "@/lib/constants/brands";
import { getBrands } from "@/lib/directus/brands";
import { getCities } from "@/lib/directus/cities";
import { getStores } from "@/lib/directus/stores";
import { getPublishedArticles } from "@/lib/articles/articles";
import { siteUrl } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

const staticPaths = [
  "/",
  "/stores/",
  "/bonus/",
  "/o-kompanii/",
  "/kontakty/",
  "/reklama/",
  "/stati/",
  ...AMPER_SEO_CATEGORY_PATHS,
  ...VENTIL_SEO_CATEGORY_PATHS,
  ...METIZ_SEO_CATEGORY_PATHS,
  ...MISKA_SEO_CATEGORY_PATHS,
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [brands, cities, stores, promotions, vacancies, faqs] = await Promise.all([
    getBrands(), getCities(), getStores(),
    getActualItemsByType("promotion"), getActualItemsByType("vacancy"), getFaqs(),
  ]);
  const activeBrandSlugs = new Set(brands.filter((brand) => brand.active).map((brand) => brand.slug));
  // Match the empty-listing noindex policy used by the page metadata.
  const listingPaths = [
    ...(promotions.length ? ["/akcii/"] : []),
    ...(vacancies.length ? ["/vakansii/"] : []),
    ...(faqs.length ? ["/faq/"] : []),
  ];
  const indexablePaths = [...staticPaths, ...listingPaths].filter((path) => {
    const brandSlug = path.split("/")[1];
    return !isCanonicalBrandSlug(brandSlug) || activeBrandSlugs.has(brandSlug);
  });
  const cityById = new Map(cities.map((city) => [city.id, city]));
  const entries: MetadataRoute.Sitemap = indexablePaths.map((path) => ({
    url: new URL(path, siteUrl).href,
    changeFrequency: path === "/" || path.startsWith("/amper/") || path.startsWith("/ventil/") || path.startsWith("/metiz-market/") || path.startsWith("/miska/") ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path.startsWith("/amper/") || path.startsWith("/ventil/") || path.startsWith("/metiz-market/") || path.startsWith("/miska/") ? 0.8 : 0.7,
  }));

  for (const article of getPublishedArticles()) {
    entries.push({ url: new URL(`/stati/${article.slug}/`, siteUrl).href, lastModified: article.updatedAt, changeFrequency: "monthly", priority: 0.7 });
  }
  // CMS normalizers can synthesize updated_at; omit it until provenance is explicit.
  for (const brand of brands.filter((item) => item.active && isCanonicalBrandSlug(item.slug))) {
    entries.push({ url: new URL(`/${brand.slug}/`, siteUrl).href, changeFrequency: "weekly", priority: 0.8 });
  }
  for (const city of cities.filter((item) => item.active)) {
    entries.push({ url: new URL(`/stores/${city.slug}/`, siteUrl).href, changeFrequency: "weekly", priority: 0.8 });
  }
  for (const store of stores.filter((item) => item.active)) {
    const city = cityById.get(store.city_id);
    if (city?.active && brands.some((brand) => brand.id === store.brand_id)) entries.push({ url: new URL(`/stores/${city.slug}/${store.slug}/`, siteUrl).href, changeFrequency: "weekly", priority: 0.9 });
  }
  return entries;
}
