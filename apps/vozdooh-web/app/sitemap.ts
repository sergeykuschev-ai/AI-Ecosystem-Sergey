import type { MetadataRoute } from "next";
import { getPublicBrands } from "@/lib/brands/public";
import { absoluteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const brands = getPublicBrands();
  return [
    { url: absoluteUrl("/"), changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl("/brands"), changeFrequency: "weekly", priority: 0.8 },
    ...brands.map((brand) => ({
      url: absoluteUrl(`/brands/${brand.slug}`),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
