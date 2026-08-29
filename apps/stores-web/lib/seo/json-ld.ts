import type { Brand } from "@/types/brand";
import type { City } from "@/types/city";
import type { Store } from "@/types/store";
import { siteUrl } from "./metadata";

type JsonLdValue = string | number | boolean | null | JsonLdObject | JsonLdValue[];
export interface JsonLdObject { [key: string]: JsonLdValue | undefined }

export function createWebsiteJsonLd(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Магазины Амурска: Ампер, Вентиль, Метиз Маркет и Миска",
    url: siteUrl.href,
    inLanguage: "ru-RU",
  };
}

export function createOrganizationsJsonLd(brands: Brand[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@graph": brands.map((brand) => ({
      "@type": "Organization",
      "@id": new URL(`/${brand.slug}/#organization`, siteUrl).href,
      name: brand.name,
      url: new URL(`/${brand.slug}/`, siteUrl).href,
      ...(brand.logo ? { logo: new URL(brand.logo, siteUrl).href } : {}),
    })),
  };
}

export function createStoreJsonLd(store: Store, brand: Brand, city: City): JsonLdObject {
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
    "@context": "https://schema.org",
    "@type": schemaTypes[brand.slug] ?? "LocalBusiness",
    "@id": new URL(`/stores/${city.slug}/${store.slug}/#business`, siteUrl).href,
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
      "@id": new URL(`/${brand.slug}/#organization`, siteUrl).href,
      name: brand.name,
    },
  };
}
