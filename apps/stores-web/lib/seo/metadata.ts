import type { Metadata } from "next";

export const siteUrl = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");

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
