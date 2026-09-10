import type { Brand } from "@/types/brand";
import type { City } from "@/types/city";
import type { FAQ } from "@/types/faq";
import type { Store } from "@/types/store";
import { siteUrl } from "./metadata";

type JsonLdValue = string | number | boolean | null | JsonLdObject | JsonLdValue[];
export interface JsonLdObject { [key: string]: JsonLdValue | undefined }

function canonicalUrl(path: string): string {
  return new URL(path, siteUrl).href;
}

function entityId(path: string, fragment: string): string {
  return `${canonicalUrl(path)}#${fragment}`;
}

export function createWebsiteJsonLd(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": entityId("/", "website"),
    name: "Магазины Амурска: Ампер, Вентиль, Метиз Маркет и Миска",
    url: siteUrl.href,
    inLanguage: "ru-RU",
  };
}

export function createContactPageJsonLd(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "ContactPage",
    "@id": entityId("/kontakty/", "webpage"),
    url: canonicalUrl("/kontakty/"),
    inLanguage: "ru-RU",
  };
}

export function createAboutPageJsonLd(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "@id": entityId("/o-kompanii/", "webpage"),
    url: canonicalUrl("/o-kompanii/"),
    inLanguage: "ru-RU",
  };
}

export function createFAQPageJsonLd(faqs: FAQ[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": entityId("/faq/", "webpage"),
    url: canonicalUrl("/faq/"),
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

export function createOrganizationsJsonLd(brands: Brand[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@graph": brands.map((brand) => ({
      "@type": "Organization",
      "@id": entityId(`/${brand.slug}/`, "organization"),
      name: brand.name,
      url: new URL(`/${brand.slug}/`, siteUrl).href,
      ...(brand.logo ? { logo: new URL(brand.logo, siteUrl).href } : {}),
    })),
  };
}

export interface BreadcrumbTrailItem {
  name: string;
  path: string;
}

export function createBreadcrumbJsonLd(trail: BreadcrumbTrailItem[]): JsonLdObject {
  const canonicalItems = trail.map((item) => ({ ...item, url: canonicalUrl(item.path) }));
  const pageUrl = canonicalItems.at(-1)?.url ?? canonicalUrl("/");
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "@id": `${pageUrl}#breadcrumb`,
    itemListElement: canonicalItems.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function createStoresJsonLd(
  stores: Store[],
  brands: Brand[],
  city: City,
): JsonLdObject {
  const brandById = new Map(brands.map((brand) => [brand.id, brand]));
  const seenIds = new Set<string>();
  return {
    "@context": "https://schema.org",
    "@graph": stores
      .map((store) => {
        const brand = brandById.get(store.brand_id);
        if (!brand) return null;
        const node = createStoreNode(store, brand, city);
        const id = node["@id"];
        if (typeof id !== "string" || seenIds.has(id)) return null;
        seenIds.add(id);
        return node;
      })
      .filter((entry): entry is JsonLdObject => entry !== null),
  };
}

export function createStoreJsonLd(store: Store, brand: Brand, city: City): JsonLdObject {
  return {
    "@context": "https://schema.org",
    ...createStoreNode(store, brand, city),
  };
}

function createStoreNode(store: Store, brand: Brand, city: City): JsonLdObject {
  const schemaTypes: Record<string, string> = {
    miska: "PetStore",
    amper: "HardwareStore",
    "metiz-market": "HardwareStore",
    ventil: "HomeGoodsStore",
  };
  const address: JsonLdObject = {
    "@type": "PostalAddress",
    addressLocality: city.name,
    addressRegion: city.region,
    addressCountry: city.country,
    ...(store.address ? { streetAddress: store.address } : {}),
    ...(store.postal_code ? { postalCode: store.postal_code } : {}),
  };

  return {
    "@type": schemaTypes[brand.slug] ?? "LocalBusiness",
    "@id": entityId(`/stores/${city.slug}/${store.slug}/`, "business"),
    name: store.name,
    url: new URL(`/stores/${city.slug}/${store.slug}/`, siteUrl).href,
    description: store.short_description,
    address,
    ...(store.telephone ? { telephone: store.telephone } : {}),
    ...(store.latitude !== null && store.longitude !== null
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: store.latitude,
            longitude: store.longitude,
          },
        }
      : {}),
    ...(store.opening_hours.length
      ? {
          openingHoursSpecification: store.opening_hours.map((entry) => ({
            "@type": "OpeningHoursSpecification",
            dayOfWeek: entry.days,
            opens: entry.opens,
            closes: entry.closes,
          })),
        }
      : {}),
    parentOrganization: {
      "@id": entityId(`/${brand.slug}/`, "organization"),
      name: brand.name,
    },
  };
}
