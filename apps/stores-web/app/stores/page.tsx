import type { Metadata } from "next";
import Link from "next/link";
import { StaticPage } from "@/components/content/StaticPage";
import { getCities } from "@/lib/directus/cities";
import { createPageMetadata } from "@/lib/seo/metadata";
export const dynamic = "force-dynamic";

export const metadata: Metadata = createPageMetadata({ title: "Магазины по городам", description: "Физические торговые точки магазинов «Ампер», «Вентиль», «Метиз Маркет» и «Миска» по городам.", path: "/stores/" });

export default async function StoresPage() {
  const cities = await getCities();
  return (
    <StaticPage eyebrow="Адреса и контакты" title="Магазины" intro="Выберите город, чтобы увидеть физические торговые точки и подтверждённую информацию о них.">
      <section className="section" aria-labelledby="cities-title">
        <h2 id="cities-title">Города</h2>
        <div className="card-grid">{cities.map((city) => <article className="card" key={city.id}><p className="eyebrow">{city.region}</p><h3>{city.name}</h3><p>{city.country}</p><Link href={`/stores/${city.slug}/`}>Магазины города <span aria-hidden="true">→</span></Link></article>)}</div>
      </section>
    </StaticPage>
  );
}
