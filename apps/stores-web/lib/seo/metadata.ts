import type { Metadata } from "next";

const rawSiteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL;
if (!rawSiteUrl) {
  throw new Error("NEXT_PUBLIC_SITE_URL or SITE_URL must be configured");
}
export const siteUrl = new URL(rawSiteUrl);

interface PageMetadataInput {
  title: string;
  description: string;
  path: string;
  noIndex?: boolean;
}

export function createPageMetadata({ title, description, path, noIndex = false }: PageMetadataInput): Metadata {
  const canonical = new URL(path, siteUrl);
  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: !noIndex, follow: !noIndex },
    openGraph: {
      type: "website",
      locale: "ru_RU",
      url: canonical,
      siteName: "Магазины Амурска",
      title,
      description,
    },
  };
}
