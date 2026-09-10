import type { Metadata } from "next";
import Link from "next/link";
import { ActualSlider } from "@/components/actual/ActualSlider";
import { BrandActualList } from "@/components/brand/BrandActualList";
import { BrandCard } from "@/components/brand/BrandCard";
import { FAQList } from "@/components/faq/FAQList";
import { JsonLd } from "@/components/seo/JsonLd";
import { FindUsSection } from "@/components/stores/FindUsSection";
import { HomeStoreSection } from "@/components/stores/HomeStoreSection";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { getBrands } from "@/lib/directus/brands";
import { getActualItems, getActualItemsByType } from "@/lib/directus/actual-items";
import { getCityBySlug } from "@/lib/directus/cities";
import { getFaqs } from "@/lib/directus/faqs";
import { getStoresByCity } from "@/lib/directus/stores";
import { createOrganizationsJsonLd, createWebsiteJsonLd } from "@/lib/seo/json-ld";
import { createPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createPageMetadata({
  title: "Ампер, Вентиль, Метиз Маркет и Миска — магазины в Амурске",
  description: "Магазины Ампер, Вентиль, Метиз Маркет и Миска в Амурске: направления, торговые точки, контакты, акции и вакансии.",
  path: "/",
});

export default async function HomePage() {
  const [brands, faqs, actualItems, promotions, city] = await Promise.all([
    getBrands(),
    getFaqs(),
    getActualItems(),
    getActualItemsByType("promotion"),
    getCityBySlug("amursk"),
  ]);
  const stores = city ? await getStoresByCity(city.id) : [];
  const extraPromotions = promotions.filter(
    (promotion) => !actualItems.some((homeItem) => homeItem.id === promotion.id),
  );
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
        {extraPromotions.length > 0 && (
          <section className="section home-promo" aria-labelledby="home-promo-title">
            <p className="eyebrow">Предложения</p>
            <h2 id="home-promo-title">Действующие акции</h2>
            <BrandActualList items={extraPromotions} />
            <p className="home-promo__more"><Link href="/akcii/">Все акции <span aria-hidden="true">→</span></Link></p>
          </section>
        )}
        {city && <FindUsSection stores={stores} brands={brands} city={city} />}
        <section className="section" aria-labelledby="faq-title">
          <h2 id="faq-title">Частые вопросы</h2>
          <FAQList items={faqs} />
        </section>
      </Container>
    </main>
  );
}
