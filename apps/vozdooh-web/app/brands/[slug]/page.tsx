import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandLanding } from "@/components/brands/BrandLanding";
import { getPublicBrand, getPublicBrands } from "@/lib/brands/public";
import { getProductsByBrand } from "@/lib/catalog/products";
import { buildBrandJsonLd } from "@/lib/seo/json-ld";
import { buildBrandMetadata } from "@/lib/seo/metadata";

export const dynamicParams = false;

export function generateStaticParams() {
  return getPublicBrands().map((brand) => ({ slug: brand.slug }));
}

export function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> | Metadata {
  // generateMetadata must stay synchronous with prerendering here; the page
  // below resolves the same params promise and renders the brand.
  return params.then(({ slug }) => {
    const brand = getPublicBrand(slug);
    if (!brand) {
      return {};
    }
    return buildBrandMetadata(brand);
  });
}

export default async function BrandPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = getPublicBrand(slug);
  if (!brand) {
    notFound();
  }
  const products = getProductsByBrand(brand.slug);
  const jsonLd = buildBrandJsonLd(brand, products);
  return (
    <main className="page">
      <BrandLanding brand={brand} products={products} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </main>
  );
}
