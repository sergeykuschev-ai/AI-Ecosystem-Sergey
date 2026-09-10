import type { Metadata } from "next";

const rawSiteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL;
if (!rawSiteUrl) {
  throw new Error("NEXT_PUBLIC_SITE_URL or SITE_URL must be configured");
}
export const siteUrl = new URL(rawSiteUrl);

// The default Open Graph image lives in the root segment as the
// opengraph-image.png file convention, but Next does not inherit file-based
// Open Graph images into child segments that define their own openGraph
// metadata, so every page must reference it explicitly.
export const DEFAULT_OG_IMAGE_PATH = "/opengraph-image.png";
export const DEFAULT_OG_IMAGE_ALT = "Магазины Ампер, Вентиль, Метиз Маркет и Миска в Амурске";
export const DEFAULT_OG_IMAGE_WIDTH = 1200;
export const DEFAULT_OG_IMAGE_HEIGHT = 630;

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
      images: [{
        url: DEFAULT_OG_IMAGE_PATH,
        alt: DEFAULT_OG_IMAGE_ALT,
        width: DEFAULT_OG_IMAGE_WIDTH,
        height: DEFAULT_OG_IMAGE_HEIGHT,
        type: "image/png",
      }],
    },
  };
}
