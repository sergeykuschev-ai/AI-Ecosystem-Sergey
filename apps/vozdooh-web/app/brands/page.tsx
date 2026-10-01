import type { Metadata } from "next";
import { BrandsIndex } from "@/components/brands/BrandsIndex";
import { getPublicBrands } from "@/lib/brands/public";
import { buildBrandsIndexJsonLd } from "@/lib/seo/json-ld";
import { buildBrandsIndexMetadata } from "@/lib/seo/metadata";

export function generateMetadata(): Metadata {
  return buildBrandsIndexMetadata(getPublicBrands().length);
}

export default function BrandsPage() {
  const brands = getPublicBrands();
  const jsonLd = buildBrandsIndexJsonLd(brands);
  return (
    <main className="page">
      <BrandsIndex brands={brands} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </main>
  );
}
