import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StaticPage } from "@/components/content/StaticPage";
import { JsonLd } from "@/components/seo/JsonLd";
import { StoreList } from "@/components/stores/StoreList";
import { getBrands } from "@/lib/directus/brands";
import { getCities, getCityBySlug } from "@/lib/directus/cities";
import { getStoresByCity } from "@/lib/directus/stores";
import { createPageMetadata } from "@/lib/seo/metadata";
import { createBreadcrumbJsonLd, createStoresJsonLd } from "@/lib/seo/json-ld";
export const dynamic = "force-dynamic";

interface CityPageProps { params: Promise<{ city: string }> }

export async function generateStaticParams() {
  return (await getCities()).map((city) => ({ city: city.slug }));
}

export async function generateMetadata({ params }: CityPageProps): Promise<Metadata> {
  const { city: slug } = await params;
  const city = await getCityBySlug(slug);
  if (!city) return {};
  return createPageMetadata({
    title: `Магазины в городе ${city.name}: Ампер, Вентиль, Метиз Маркет и Миска`,
    description: `Адреса, телефоны и режим работы магазинов «Ампер», «Вентиль», «Метиз Маркет» и «Миска» в городе ${city.name}, ${city.region}: электротовары, сантехника, крепёж и зоотовары.`,
    path: `/stores/${city.slug}/`,
  });
}
export default async function CityStoresPage({ params }: CityPageProps) {
  const { city: slug } = await params;
  const city = await getCityBySlug(slug);
  if (!city) notFound();
  const [stores, brands] = await Promise.all([getStoresByCity(city.id), getBrands()]);
  const brandIdsInCity = new Set(stores.map((store) => store.brand_id));
  const cityBrands = brands.filter((brand) => brand.active && brandIdsInCity.has(brand.id));
  return (
    <StaticPage eyebrow={`${city.region} · ${city.country}`} title={`Магазины в ${city.name}`} intro="Физические торговые точки магазинов «Ампер», «Вентиль», «Метиз Маркет» и «Миска». Откройте страницу нужной точки для подробной информации.">
      <JsonLd data={createBreadcrumbJsonLd([
        { name: "Главная", path: "/" },
        { name: "Магазины", path: "/stores/" },
        { name: city.name, path: `/stores/${city.slug}/` },
      ])} />
      <section className="section" aria-labelledby="store-list-title"><h2 id="store-list-title">Торговые точки</h2><StoreList stores={stores} brands={brands} city={city} /></section>
      {cityBrands.length > 0 && (
        <section className="section" aria-labelledby="city-directions">
          <h2 id="city-directions">Направления магазинов</h2>
          <div className="card-grid">
            {cityBrands.map((brand) => (
              <article className="card" key={brand.id} data-brand={brand.slug}>
                <h3>{brand.name}</h3>
                <p>{brand.short_description}</p>
                <Link href={`/${brand.slug}/`}>Страница магазина <span aria-hidden="true">→</span></Link>
              </article>
            ))}
          </div>
        </section>
      )}
      <p><Link href="/kontakty/">Контакты всех магазинов</Link></p>
      <JsonLd data={createStoresJsonLd(stores, brands, city)} />
    </StaticPage>
  );
}
