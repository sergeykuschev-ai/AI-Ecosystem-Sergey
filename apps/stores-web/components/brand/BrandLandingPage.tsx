import { notFound } from "next/navigation";
import { BrandActualList } from "@/components/brand/BrandActualList";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { CategoryGrid } from "@/components/categories/CategoryGrid";
import { JsonLd } from "@/components/seo/JsonLd";
import { BrandStoreContact } from "@/components/stores/BrandStoreContact";
import { Container } from "@/components/ui/Container";
import { getActualItemsByBrand } from "@/lib/directus/actual-items";
import { getBrandBySlug } from "@/lib/directus/brands";
import { getCategoriesByBrand } from "@/lib/directus/categories";
import { getCities } from "@/lib/directus/cities";
import { getStoresByBrand } from "@/lib/directus/stores";
import { createOrganizationsJsonLd } from "@/lib/seo/json-ld";

interface BrandLandingPageProps {
  slug: string;
  heroEyebrow: string;
  nameInPrepositional: string;
  aboutHeading: string;
}

export async function BrandLandingPage({
  slug,
  heroEyebrow,
  nameInPrepositional,
  aboutHeading,
}: BrandLandingPageProps) {
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();

  const [categories, stores, cities, actualItems] = await Promise.all([
    getCategoriesByBrand(brand.id),
    getStoresByBrand(brand.id),
    getCities(),
    getActualItemsByBrand(brand.id),
  ]);
  const store = stores[0];
  const city = cities.find((item) => item.id === store?.city_id);

  return (
    <main className="brand-landing" data-brand={brand.slug} style={{ "--brand-color": brand.primary_color } as React.CSSProperties}>
      <JsonLd data={createOrganizationsJsonLd([brand])} />
      <Container>
        <header className="brand-landing-hero">
          <div className="brand-landing-hero__logo">
            <BrandLogo brand={brand} />
          </div>
          <div className="brand-landing-hero__content">
            <p className="eyebrow">{heroEyebrow}</p>
            <h1>{brand.name}</h1>
            <p className="lead">{brand.short_description}</p>
          </div>
        </header>

        <section className="brand-landing-section" aria-labelledby="brand-assortment">
          <p className="eyebrow">Ассортимент</p>
          <h2 id="brand-assortment">Что есть в «{nameInPrepositional}»</h2>
          <CategoryGrid categories={categories} variant="brand-landing" />
        </section>

        <section className="brand-landing-section brand-landing-about" aria-labelledby="brand-about">
          <h2 id="brand-about">{aboutHeading}</h2>
          <p>{brand.description}</p>
        </section>

        {actualItems.length > 0 && (
          <section className="brand-landing-section" aria-labelledby="brand-actual">
            <p className="eyebrow">Для покупателей</p>
            <h2 id="brand-actual">Актуальное в «{nameInPrepositional}»</h2>
            <BrandActualList items={actualItems} />
          </section>
        )}

        {store && city && (
          <section className="brand-landing-section brand-landing-section--contact" aria-label={`Контакты магазина ${brand.name}`}>
            <BrandStoreContact store={store} brand={brand} city={city} />
          </section>
        )}
      </Container>
    </main>
  );
}
