import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StaticPage } from "@/components/content/StaticPage";
import { StoreList } from "@/components/stores/StoreList";
import { getBrands } from "@/lib/directus/brands";
import { getCities, getCityBySlug } from "@/lib/directus/cities";
import { getStoresByCity } from "@/lib/directus/stores";
import { createPageMetadata } from "@/lib/seo/metadata";
export const dynamic = "force-dynamic";

interface CityPageProps { params: Promise<{ city: string }> }

export async function generateStaticParams() {
  return (await getCities()).map((city) => ({ city: city.slug }));
}

export async function generateMetadata({ params }: CityPageProps): Promise<Metadata> {
  const { city: slug } = await params;
  const city = await getCityBySlug(slug);
  if (!city) return {};
  return createPageMetadata({ title: `Магазины в ${city.name}`, description: `Физические магазины Ампер, Вентиль, Метиз Маркет и Миска в городе ${city.name}, ${city.region}.`, path: `/stores/${city.slug}/` });
}

export default async function CityStoresPage({ params }: CityPageProps) {
  const { city: slug } = await params;
  const city = await getCityBySlug(slug);
  if (!city) notFound();
  const [stores, brands] = await Promise.all([getStoresByCity(city.id), getBrands()]);
  return (
    <StaticPage eyebrow={`${city.region} · ${city.country}`} title={`Магазины в ${city.name}`} intro="Физические торговые точки магазинов «Ампер», «Вентиль», «Метиз Маркет» и «Миска». Откройте страницу нужной точки для подробной информации.">
      <section className="section" aria-labelledby="store-list-title"><h2 id="store-list-title">Торговые точки</h2><StoreList stores={stores} brands={brands} city={city} /></section>
    </StaticPage>
  );
}
