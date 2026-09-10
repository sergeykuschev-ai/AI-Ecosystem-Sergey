import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryGrid } from "@/components/categories/CategoryGrid";
import { JsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { StoreContactBlock } from "@/components/stores/StoreContactBlock";
import { Container } from "@/components/ui/Container";
import { getBrands } from "@/lib/directus/brands";
import { getCategoriesByBrand } from "@/lib/directus/categories";
import { getCities, getCityBySlug } from "@/lib/directus/cities";
import { getStoreBySlug, getStores } from "@/lib/directus/stores";
import { createStoreJsonLd } from "@/lib/seo/json-ld";
import { createPageMetadata } from "@/lib/seo/metadata";
export const dynamic = "force-dynamic";

interface StorePageProps { params: Promise<{ city: string; store: string }> }

export async function generateStaticParams() {
  const [cities, stores] = await Promise.all([getCities(), getStores()]);
  return stores.flatMap((store) => {
    const city = cities.find((item) => item.id === store.city_id);
    return city ? [{ city: city.slug, store: store.slug }] : [];
  });
}

async function getPageData(citySlug: string, storeSlug: string) {
  const city = await getCityBySlug(citySlug);
  if (!city) return null;
  const store = await getStoreBySlug(city.id, storeSlug);
  if (!store) return null;
  const brands = await getBrands();
  const brand = brands.find((item) => item.id === store.brand_id) ?? null;
  return brand ? { city, store, brand } : null;
}

export async function generateMetadata({ params }: StorePageProps): Promise<Metadata> {
  const { city, store } = await params;
  const data = await getPageData(city, store);
  if (!data) notFound();
  return createPageMetadata({ title: data.store.seo_title, description: data.store.seo_description, path: `/stores/${city}/${store}/` });
}

export default async function StorePage({ params }: StorePageProps) {
  const { city: citySlug, store: storeSlug } = await params;
  const data = await getPageData(citySlug, storeSlug);
  if (!data) notFound();
  const { city, store, brand } = data;
  const categories = await getCategoriesByBrand(brand.id);
  return (
    <main>
      <JsonLd data={createStoreJsonLd(store, brand, city)} />
      <Container>
        <Breadcrumbs trail={[
          { name: "Главная", path: "/" },
          { name: `Магазины ${city.name}`, path: `/stores/${city.slug}/` },
          { name: store.name, path: `/stores/${city.slug}/${store.slug}/` },
        ]} />
        <header className="store-hero" style={{ "--brand-color": brand.primary_color, "--brand-soft": brand.secondary_color } as React.CSSProperties}>
          <p className="eyebrow">{brand.name} · {city.name}</p>
          <h1>{store.name}</h1>
          <p className="lead">{store.short_description}</p>
          {store.temporarily_closed && <p className="status-warning">Магазин временно закрыт</p>}
        </header>
        <div className="content-columns">
          <StoreContactBlock store={store} />
          <section className="section" aria-labelledby="about-store"><h2 id="about-store">О магазине</h2><p>{store.description}</p></section>
        </div>
        <section className="section" aria-labelledby="store-categories"><h2 id="store-categories">Основные категории</h2><CategoryGrid categories={categories} /></section>
        <section className="section" aria-labelledby="brand-details">
          <h2 id="brand-details">Магазин «{brand.name}»</h2>
          <p>
            Направления ассортимента, актуальные акции и бонусная программа — на{" "}
            <Link href={`/${brand.slug}/`}>странице магазина «{brand.name}»</Link>.
          </p>
          <p><Link href="/kontakty/">Контакты всех магазинов</Link></p>
        </section>
      </Container>
    </main>
  );
}
