import type { PublicBrand } from "@/lib/brands/public";
import { getCatalogPresenceSentence } from "@/lib/brands/public";
import type { CatalogProduct } from "@/lib/catalog/products";
import { CATEGORY_LABELS } from "@/lib/catalog/products";
import { SITE_NAME, absoluteUrl } from "@/lib/site";

type JsonLdObject = Record<string, unknown>;

/**
 * Structured data for a brand landing page.
 * Uses only verified facts (brand name, verified statements, catalog counts).
 */
export function buildBrandJsonLd(brand: PublicBrand, products: CatalogProduct[]): JsonLdObject {
  const pageUrl = absoluteUrl(`/brands/${brand.slug}`);
  const brandDescription = [
    ...brand.verifiedClaims.map((claim) => claim.statement),
    getCatalogPresenceSentence(brand.name, brand.productCount),
  ].join(" ");

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": pageUrl,
        url: pageUrl,
        name: `${brand.name} — ${SITE_NAME}`,
        description: brandDescription,
        inLanguage: "ru-RU",
        isPartOf: { "@id": absoluteUrl("/#site") },
        about: { "@id": `${pageUrl}#brand` },
        breadcrumb: { "@id": `${pageUrl}#breadcrumb` },
      },
      {
        "@type": "Brand",
        "@id": `${pageUrl}#brand`,
        name: brand.name,
        description: brandDescription,
        url: pageUrl,
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${pageUrl}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Главная", item: absoluteUrl("/") },
          { "@type": "ListItem", position: 2, name: "Бренды", item: absoluteUrl("/brands") },
          { "@type": "ListItem", position: 3, name: brand.name, item: pageUrl },
        ],
      },
      {
        "@type": "ItemList",
        "@id": `${pageUrl}#products`,
        name: `Позиции бренда ${brand.name} в каталоге ${SITE_NAME}`,
        itemListElement: products.map((product, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "Product",
            name: `${CATEGORY_LABELS[product.category]}, ${product.variant}`,
            brand: { "@id": `${pageUrl}#brand` },
            category: CATEGORY_LABELS[product.category],
          },
        })),
      },
    ],
  };
}

/** JSON-LD for the brand index page. */
export function buildBrandsIndexJsonLd(brands: PublicBrand[]): JsonLdObject {
  const pageUrl = absoluteUrl("/brands");
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": pageUrl,
    url: pageUrl,
    name: `Бренды — ${SITE_NAME}`,
    inLanguage: "ru-RU",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: brands.map((brand, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "Brand",
          name: brand.name,
          url: absoluteUrl(`/brands/${brand.slug}`),
        },
      })),
    },
  };
}
