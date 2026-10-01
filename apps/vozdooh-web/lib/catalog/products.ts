export type CatalogCategory = "diffuser" | "candle" | "room-spray" | "refill";

export type CatalogProduct = {
  slug: string;
  /** Must reference an existing brand slug from lib/brands. */
  brandSlug: string;
  category: CatalogCategory;
  /** Volume/weight/size variant, e.g. "500 мл". */
  variant: string;
  /** Public product page path once product routes exist (issue #199).
   *  While undefined the product renders as a non-linked card. */
  url?: string;
};

export const CATEGORY_LABELS: Record<CatalogCategory, string> = {
  diffuser: "Ароматический диффузор",
  candle: "Ароматическая свеча",
  "room-spray": "Спрей для помещений",
  refill: "Наполнитель для диффузора",
};

/**
 * Initial VOZDOOH catalog seed. This is the authoritative catalog slice for
 * the brand layer until the full catalog lands with issue #199
 * (product cards, prices, product routes).
 * Deliberately generic: no collection or scent names are invented here.
 */
export const CATALOG_PRODUCTS: CatalogProduct[] = [
  // Culti Milano
  { slug: "culti-milano-diffuser-500", brandSlug: "culti-milano", category: "diffuser", variant: "500 мл" },
  { slug: "culti-milano-candle-250", brandSlug: "culti-milano", category: "candle", variant: "250 г" },
  { slug: "culti-milano-room-spray-100", brandSlug: "culti-milano", category: "room-spray", variant: "100 мл" },
  // Teatro Fragranze Uniche
  { slug: "teatro-fragranze-uniche-diffuser-250", brandSlug: "teatro-fragranze-uniche", category: "diffuser", variant: "250 мл" },
  { slug: "teatro-fragranze-uniche-candle-180", brandSlug: "teatro-fragranze-uniche", category: "candle", variant: "180 г" },
  { slug: "teatro-fragranze-uniche-room-spray-100", brandSlug: "teatro-fragranze-uniche", category: "room-spray", variant: "100 мл" },
  // Ladenac
  { slug: "ladenac-diffuser-200", brandSlug: "ladenac", category: "diffuser", variant: "200 мл" },
  { slug: "ladenac-candle-200", brandSlug: "ladenac", category: "candle", variant: "200 г" },
  // Millefiori Milano
  { slug: "millefiori-milano-diffuser-250", brandSlug: "millefiori-milano", category: "diffuser", variant: "250 мл" },
  { slug: "millefiori-milano-refill-500", brandSlug: "millefiori-milano", category: "refill", variant: "500 мл" },
  { slug: "millefiori-milano-room-spray-100", brandSlug: "millefiori-milano", category: "room-spray", variant: "100 мл" },
];

export function getProductsByBrand(brandSlug: string): CatalogProduct[] {
  return CATALOG_PRODUCTS.filter((product) => product.brandSlug === brandSlug);
}
