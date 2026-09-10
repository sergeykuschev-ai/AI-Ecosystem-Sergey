import type { Metadata } from "next";
import Link from "next/link";
import { BrandLandingPage } from "@/components/brand/BrandLandingPage";
import { createPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createPageMetadata({
  title: "Вентиль — магазин сантехники в Амурске | Проспект Победы, 16",
  description:
    "Магазин сантехники «Вентиль» в Амурске: сантехника, водоснабжение, отопление, смесители, канализация и комплектующие. Адрес: проспект Победы, 16.",
  path: "/ventil/",
});

const WATER_HEATING_TEXT =
  "В магазине можно подобрать товары для систем водоснабжения и отопления, а также для ремонта и замены сантехнических элементов — по направлениям, представленным в ассортименте.";

const REPAIR_TEXT =
  "Если нужно заменить отдельный элемент или собрать набор товаров для ремонта, в магазине можно подобрать подходящие позиции из текущего ассортимента.";

const ASSISTANCE_TEXT =
  "В магазине работают продавцы-консультанты: помогут сориентироваться в ассортименте и подобрать товар под вашу задачу.";

const BONUS_FACTS = [
  { value: "5%", label: "начисляем бонусами" },
  { value: "до 15%", label: "можно оплатить бонусами" },
  { value: "3 месяца", label: "срок действия бонусов" },
];

const BONUS_NOTE = "Бонусная карта в «Вентиле» выдаётся при покупке от 3 500 ₽.";

const CONTACT_NOTE =
  "Магазин находится в центре Амурска: рядом автобусные остановки, удобно добираться пешком.";

function VentilFeaturedSections() {
  return (
    <>
      <section className="brand-landing-section" aria-label="Основные направления">
        <div className="ventil-feature-grid">
          <article className="ventil-feature-card">
            <h2>Для водоснабжения и отопления</h2>
            <p>{WATER_HEATING_TEXT}</p>
          </article>
          <article className="ventil-feature-card">
            <h2>Для ремонта и замены</h2>
            <p>{REPAIR_TEXT}</p>
          </article>
        </div>
      </section>

      <section className="brand-landing-section brand-landing-section--compact" aria-labelledby="ventil-assistance">
        <div className="ventil-assist-panel">
          <h2 id="ventil-assistance">Поможем подобрать нужное</h2>
          <p>{ASSISTANCE_TEXT}</p>
        </div>
      </section>

      <section className="brand-landing-section" aria-labelledby="ventil-bonus">
        <h2 id="ventil-bonus">Бонусная программа</h2>
        <ul className="ventil-bonus-facts">
          {BONUS_FACTS.map((fact) => (
            <li key={fact.value}>
              <strong>{fact.value}</strong>
              <span>{fact.label}</span>
            </li>
          ))}
        </ul>
        <p className="ventil-bonus-note">{BONUS_NOTE}</p>
        <div className="button-row">
          <Link className="button button--secondary" href="/bonus/">
            Подробнее о бонусной программе
          </Link>
        </div>
      </section>
    </>
  );
}

export default function Page() {
  return (
    <BrandLandingPage
      slug="ventil"
      heroEyebrow="Вентиль"
      heroTitle="Сантехника для дома и ремонта в Амурске"
      heroLead="Сантехника, водоснабжение, отопление, смесители, канализация и комплектующие — в магазине «Вентиль» на проспекте Победы, 16."
      nameInPrepositional="Вентиле"
      assortmentHeading="Что можно найти в «Вентиле»"
      showAbout={false}
      heroContactActions
      featuredSections={<VentilFeaturedSections />}
      contactHeading="Вентиль в Амурске"
      contactNote={CONTACT_NOTE}
      contactCallAction
      contactsHref="/kontakty/"
    />
  );
}
