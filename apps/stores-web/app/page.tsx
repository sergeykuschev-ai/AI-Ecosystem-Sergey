import type { Metadata } from "next";
import { ActualSlider } from "@/components/actual/ActualSlider";
import { BrandCard } from "@/components/brand/BrandCard";
import { FAQList } from "@/components/faq/FAQList";
import { JsonLd } from "@/components/seo/JsonLd";
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

export const metadata: Metadata = createPageMetadata({
  title: "Ампер, Вентиль, Метиз Маркет и Миска — магазины в Амурске",
  description: "Магазины Ампер, Вентиль, Метиз Маркет и Миска в Амурске: направления, торговые точки, контакты, акции и вакансии.",
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
          <p className="lead">Официальная информация о магазинах «Ампер», «Вентиль», «Метиз Маркет» и «Миска» и их торговых точках в Амурске.</p>
          <div className="button-row"><Button href="/stores/amursk/">Найти магазин</Button><Button href="#brands" variant="secondary">Выбрать магазин</Button></div>
        </section>
        <ActualSlider items={actualItems} brands={brands} />
        <section className="section" aria-labelledby="brands">
          <p className="eyebrow">Магазины</p>
          <h2 id="brands">Выберите магазин</h2>
          <div className="brand-grid">{brands.map((brand) => <BrandCard key={brand.id} brand={brand} />)}</div>
        </section>
        {city && <HomeStoreSection stores={stores} brands={brands} city={city} />}
        <section className="section" aria-labelledby="faq-title">
          <h2 id="faq-title">Частые вопросы</h2>
          <FAQList items={faqs} />
        </section>
      </Container>
    </main>
  );
}
