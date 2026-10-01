import type { Metadata } from "next";
import type { PublicBrand } from "@/lib/brands/public";
import { getCatalogPresenceSentence } from "@/lib/brands/public";
import { SITE_NAME, absoluteUrl } from "@/lib/site";

/**
 * SEO description for a brand page. Built exclusively from verified facts:
 * brand name, verified claim statements and catalog counts.
 */
export function buildBrandDescription(brand: PublicBrand): string {
  const parts: string[] = [];
  for (const claim of brand.verifiedClaims) {
    parts.push(claim.statement);
  }
  parts.push(getCatalogPresenceSentence(brand.name, brand.productCount));
  return parts.join(" ");
}

export function buildBrandMetadata(brand: PublicBrand): Metadata {
  const description = buildBrandDescription(brand);
  const url = absoluteUrl(`/brands/${brand.slug}`);
  return {
    // The root layout template appends the site name; keep the page title
    // free of it to avoid duplication.
    title: brand.name,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `${brand.name} — ${SITE_NAME}`,
      description,
      url,
      siteName: SITE_NAME,
      type: "website",
      locale: "ru_RU",
    },
  };
}

export function buildBrandsIndexMetadata(brandsCount: number): Metadata {
  const description = `Бренды ароматов для дома в каталоге ${SITE_NAME}: ${brandsCount} ${brandsCount === 1 ? "бренд" : "бренда"}. Только проверенные факты о брендах.`;
  const url = absoluteUrl("/brands");
  return {
    title: "Бренды",
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `Бренды — ${SITE_NAME}`,
      description,
      url,
      siteName: SITE_NAME,
      type: "website",
      locale: "ru_RU",
    },
  };
}
