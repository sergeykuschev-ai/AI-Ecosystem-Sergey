import { getProductsByBrand } from "@/lib/catalog/products";
import { BRANDS, getBrandBySlug } from "./brands";
import type { Brand, BrandClaim } from "./types";

/** Public, page-safe view of a brand. Built ONLY from verified claims. */
export type PublicBrand = {
  slug: string;
  name: string;
  verifiedClaims: BrandClaim[];
  productCount: number;
  /** False when the brand has no verified story yet (honest-notice path). */
  hasVerifiedStory: boolean;
};

const NO_STORY_NOTICE =
  "Мы пока не публикуем сведения об этом бренде: наша команда проверяет первоисточники. " +
  "Здесь и далее на сайте мы размещаем только подтверждённые факты о брендах.";

export function toPublicBrand(brand: Brand): PublicBrand {
  const verifiedClaims = brand.claims.filter((claim) => claim.status === "verified");
  return {
    slug: brand.slug,
    name: brand.name,
    verifiedClaims,
    productCount: getProductsByBrand(brand.slug).length,
    hasVerifiedStory: verifiedClaims.length > 0,
  };
}

export function getPublicBrands(): PublicBrand[] {
  return BRANDS.map(toPublicBrand);
}

export function getPublicBrand(slug: string): PublicBrand | undefined {
  const brand = getBrandBySlug(slug);
  return brand ? toPublicBrand(brand) : undefined;
}

/**
 * Copy shown on a brand page that has no verified facts yet.
 * Contains no brand-specific factual claims by construction.
 */
export function getNoStoryNotice(): string {
  return NO_STORY_NOTICE;
}

/** Editorial line for the products section — shop voice, no factual claims. */
export function getProductsSectionIntro(brandName: string): string {
  return `Позиции ${brandName}, представленные в каталоге VOZDOOH.`;
}

/** Catalog-presence sentence; derived from catalog data, safe to state as fact. */
export function getCatalogPresenceSentence(brandName: string, productCount: number): string {
  return `В каталоге VOZDOOH представлено ${productCount} ${pluralizeProducts(productCount)} бренда ${brandName}.`;
}

function pluralizeProducts(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return "товаров";
  if (mod10 === 1) return "товар";
  if (mod10 >= 2 && mod10 <= 4) return "товара";
  return "товаров";
}
