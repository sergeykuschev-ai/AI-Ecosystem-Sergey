import type { Metadata } from "next";
import Link from "next/link";
import { TrackedLink } from "@/components/analytics/TrackedLink";
import { StaticPage } from "@/components/content/StaticPage";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { JsonLd } from "@/components/seo/JsonLd";
import { getBrands } from "@/lib/directus/brands";
import { getCityBySlug } from "@/lib/directus/cities";
import { getStoresByCity } from "@/lib/directus/stores";
import { createAboutPageJsonLd } from "@/lib/seo/json-ld";
import { createPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createPageMetadata({
  title: "О компании | Магазины Ампер, Вентиль, Метиз Маркет и Миска в Амурске",
  description:
    "Четыре магазина в центре Амурска по адресу проспект Победы, 16: электротовары, сантехника, крепёж и товары для питомцев.",
  path: "/o-kompanii/",
});

interface AboutBrandCardConfig {
  slug: string;
  name: string;
  tag: string;
  text: string;
  note?: string;
}

const ABOUT_BRAND_CARDS: AboutBrandCardConfig[] = [
  {
    slug: "amper",
    name: "Ампер",
    tag: "Магазин электротоваров",
    text: "Электротовары для дома, ремонта и повседневных задач.",
    note: "Работает в Амурске с 2018 года.",
  },
  {
    slug: "ventil",
    name: "Вентиль",
    tag: "Магазин сантехники",
    text: "Сантехника и товары для водоснабжения, отопления и ремонта.",
  },
  {
    slug: "metiz-market",
    name: "Метиз Маркет",
    tag: "Магазин метизов и крепежа",
    text: "Крепёж, метизы и сопутствующие товары для ремонта и хозяйственных задач.",
  },
  {
    slug: "miska",
    name: "Миска",
    tag: "Магазин зоотоваров",
    text: "Товары для собак и кошек, питание, ветеринарные рационы и одежда для питомцев.",
  },
];

const ABOUT_INTRO_NOTE =
  "«Ампер» работает в Амурске с 2018 года. Сегодня по адресу проспект Победы, 16 работают четыре магазина: «Ампер», «Вентиль», «Метиз Маркет» и «Миска».";

const LOCATION_TEXT =
  "Все четыре магазина находятся по адресу проспект Победы, 16.";

const ASSISTANCE_TEXT =
  "В магазинах работают продавцы-консультанты, которые помогут сориентироваться в ассортименте и подобрать товар под конкретную задачу.";

const MISKA_TEXT =
  "В «Миске» представлен большой выбор кормов для собак и кошек, включая ветеринарские и монопротеиновые рационы. Такие варианты позволяют подобрать питание с учётом особенностей питомца, в том числе при аллергии или пищевой непереносимости. При выборе специализированного рациона ориентируйтесь на рекомендации ветеринарного врача.";

const MISKA_CLOTHING_TEXT =
  "Также в магазине представлен большой выбор одежды для собак — демисезонные и зимние модели.";

export default async function AboutPage() {
  const [brands, city] = await Promise.all([getBrands(), getCityBySlug("amursk")]);
  const stores = city ? await getStoresByCity(city.id) : [];
  const mapUrl = stores.map((store) => store.map_links.find((link) => link.url)?.url).find(Boolean) ?? null;

  return (
    <main className="about-page">
      <JsonLd data={createAboutPageJsonLd()} />
      <StaticPage
        eyebrow="О нас"
        title="Четыре магазина в Амурске"
        intro="Электротовары, сантехника, крепёж и товары для питомцев — в магазинах по адресу проспект Победы, 16."
      >
        <p className="about-intro-note">{ABOUT_INTRO_NOTE}</p>

        <section className="about-section" aria-labelledby="about-stores-title">
          <h2 id="about-stores-title">Четыре магазина — разные задачи</h2>
          <div className="brand-grid">
            {ABOUT_BRAND_CARDS.map((card) => {
              const brand = brands.find((item) => item.slug === card.slug && item.active);
              return (
                <article className="brand-card" data-brand={card.slug} key={card.slug}>
                  {brand ? <BrandLogo brand={brand} /> : null}
                  <h3>{card.name}</h3>
                  <p className="about-brand-card__tag">{card.tag}</p>
                  <p>{card.text}</p>
                  {card.note ? <p className="about-brand-card__note">{card.note}</p> : null}
                  <TrackedLink event="brand_open" payload={{ brand: card.slug }} href={`/${card.slug}/`}>
                    О магазине <span aria-hidden="true">→</span>
                  </TrackedLink>
                </article>
              );
            })}
          </div>
        </section>

        <section className="about-section" aria-labelledby="about-location-title">
          <h2 id="about-location-title">Магазины в Амурске</h2>
          <p>{LOCATION_TEXT}</p>
          <div className="button-row">
            <Link className="button button--primary" href="/kontakty/">
              Контакты и режим работы
            </Link>
            {mapUrl ? (
              <TrackedLink className="button button--secondary" event="click_route" payload={{ source: "about" }} href={mapUrl} target="_blank" rel="noopener noreferrer">
                Показать на карте
              </TrackedLink>
            ) : null}
          </div>
        </section>

        <section className="about-section" aria-labelledby="about-assistance-title">
          <h2 id="about-assistance-title">Поможем подобрать нужный товар</h2>
          <p>{ASSISTANCE_TEXT}</p>
        </section>

        <section className="split-panel" aria-labelledby="about-miska-title">
          <div>
            <h2 id="about-miska-title">Корма и одежда для питомцев в «Миске»</h2>
            <p>{MISKA_TEXT}</p>
            <p>{MISKA_CLOTHING_TEXT}</p>
          </div>
          <TrackedLink className="button button--secondary" event="brand_open" payload={{ brand: "miska" }} href="/miska/">
            Подробнее о «Миске»
          </TrackedLink>
        </section>

        <section className="about-section" aria-labelledby="about-choose-title">
          <h2 id="about-choose-title">Выберите нужный магазин</h2>
          <div className="button-row">
            {ABOUT_BRAND_CARDS.map((card) => (
              <TrackedLink className="button button--secondary" event="brand_open" payload={{ brand: card.slug }} href={`/${card.slug}/`} key={card.slug}>
                {card.name}
              </TrackedLink>
            ))}
            <Link className="button button--primary" href="/kontakty/">
              Контакты и режим работы
            </Link>
          </div>
        </section>
      </StaticPage>
    </main>
  );
}
