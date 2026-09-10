import type { Metadata } from "next";
import { ActualSlider } from "@/components/actual/ActualSlider";
import { BrandCard } from "@/components/brand/BrandCard";
import { FAQList } from "@/components/faq/FAQList";
import { JsonLd } from "@/components/seo/JsonLd";
import { FindUsSection } from "@/components/stores/FindUsSection";
import { HomeStoreSection } from "@/components/stores/HomeStoreSection";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { getBrands } from "@/lib/directus/brands";
import { getActualItems } from "@/lib/directus/actual-items";
import { getCityBySlug } from "@/lib/directus/cities";
import { getFaqs } from "@/lib/directus/faqs";
import { getStoresByCity } from "@/lib/directus/stores";
import { createOrganizationsJsonLd, createWebsiteJsonLd } from "@/lib/seo/json-ld";
import { createPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createPageMetadata({
  title: "Ампер, Вентиль, Метиз Маркет и Миска — магазины в Амурске",
  description:
    "Электротовары «Ампер», сантехника «Вентиль», крепёж «Метиз Маркет» и зоотовары «Миска» в Амурске: адреса, телефоны, режим работы, акции и бонусы.",
  path: "/",
});

export default async function HomePage() {
  const [brands, faqs, actualItems, city] = await Promise.all([
    getBrands(),
    getFaqs(),
    getActualItems(),
    getCityBySlug("amursk"),
  ]);
  const stores = city ? await getStoresByCity(city.id) : [];
  return (
    <main>
      <JsonLd data={createWebsiteJsonLd()} />
      <JsonLd data={createOrganizationsJsonLd(brands)} />
      <Container>
        <section className="home-hero" aria-labelledby="home-title">
          <p className="eyebrow">Амурск · Хабаровский край</p>
          <h1 id="home-title">Четыре магазина. Всё для дома, ремонта и питомцев.</h1>
          <p className="lead">«Ампер», «Вентиль», «Метиз Маркет» и «Миска»: направления, торговые точки, телефоны и действующие акции магазинов в Амурске.</p>
          <div className="button-row">
            <Button href="/stores/amursk/">Найти магазин</Button>
            <Button href="/akcii/" variant="secondary">Акции</Button>
            <Button href="#find-us" variant="secondary">Как нас найти</Button>
          </div>
        </section>
        <section className="section home-brands" aria-labelledby="brands-title">
          <p className="eyebrow">Магазины</p>
          <h2 id="brands-title">Выберите магазин</h2>
          <div className="brand-grid">{brands.map((brand) => <BrandCard key={brand.id} brand={brand} />)}</div>
        </section>
        <ActualSlider items={actualItems} brands={brands} />
        {city && <HomeStoreSection stores={stores} brands={brands} city={city} />}
        {city && <FindUsSection stores={stores} brands={brands} city={city} />}
        <section className="section" aria-labelledby="faq-title">
          <h2 id="faq-title">Частые вопросы</h2>
          <FAQList items={faqs} />
        </section>
      </Container>
    </main>
  );
}
