export const CANONICAL_BRAND_SLUGS = ["amper", "ventil", "metiz-market", "miska"] as const;

export type CanonicalBrandSlug = (typeof CANONICAL_BRAND_SLUGS)[number];

export interface BrandPalette {
  primaryColor: string;
  secondaryColor: string;
}

export const BRAND_PALETTE: Record<CanonicalBrandSlug, BrandPalette> = {
  amper: { primaryColor: "#f4c300", secondaryColor: "#fff7cc" },
  ventil: { primaryColor: "#1769aa", secondaryColor: "#e8f2fb" },
  "metiz-market": { primaryColor: "#c62828", secondaryColor: "#f2f3f5" },
  miska: { primaryColor: "#1a7a3a", secondaryColor: "#fdeede" },
};

export function isCanonicalBrandSlug(slug: string): slug is CanonicalBrandSlug {
  return (CANONICAL_BRAND_SLUGS as readonly string[]).includes(slug);
}
