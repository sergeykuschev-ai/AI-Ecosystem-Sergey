import type { Metadata } from "next";
import Link from "next/link";
import { BrandLandingPage } from "@/components/brand/BrandLandingPage";
import { createPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createPageMetadata({
  title: "Метиз Маркет — крепёж, метизы и инструмент в Амурске | Проспект Победы, 16",
  description:
    "Магазин «Метиз Маркет» в Амурске: крепёж, метизы, ручной и электроинструмент, расходные материалы для ремонта и монтажа. Адрес: проспект Победы, 16.",
  path: "/metiz-market/",
});

const REPAIR_MOUNTING_TEXT =
  "В «Метиз Маркете» можно собрать всё необходимое для ремонта и монтажа: от крепежа для крепления полок и карнизов до инструмента и расходных материалов для текущих и строительных работ.";

const FASTENERS_CONSUMABLES_TEXT =
  "В ассортименте представлены саморезы, болты, гайки, анкеры, дюбели, крепёж для разных материалов, а также расходные материалы — всё для того, чтобы работа была доведена до конца.";

const ASSISTANCE_TEXT =
  "Не уверены в диаметре или длине крепежа, выборе сверла или насадки? Продавцы-консультанты помогут подобрать подходящий крепёж или инструмент под вашу задачу.";

const BONUS_FACTS = [
  { value: "5%", label: "начисляем бонусами" },
  { value: "до 15%", label: "можно оплатить бонусами" },
  { value: "3 месяца", label: "срок действия бонусов" },
];

const BONUS_NOTE = "Бонусная карта в «Метиз Маркете» выдаётся при покупке от 3 500 ₽.";

const CONTACT_NOTE =
  "Магазин находится в центре Амурска: рядом автобусные остановки, удобно добираться пешком.";

function MetizMarketFeaturedSections() {
  return (
    <>
      <section className="brand-landing-section" aria-label="Основные направления">
        <div className="metiz-feature-grid">
          <article className="metiz-feature-card">
            <h2>Для ремонта и монтажа</h2>
            <p>{REPAIR_MOUNTING_TEXT}</p>
          </article>
          <article className="metiz-feature-card">
            <h2>Крепёж и расходные материалы</h2>
            <p>{FASTENERS_CONSUMABLES_TEXT}</p>
          </article>
        </div>
      </section>

      <section className="brand-landing-section brand-landing-section--compact" aria-labelledby="metiz-assistance">
        <div className="metiz-assist-panel">
          <h2 id="metiz-assistance">Поможем подобрать нужное</h2>
          <p>{ASSISTANCE_TEXT}</p>
        </div>
      </section>

      <section className="brand-landing-section" aria-labelledby="metiz-bonus">
        <h2 id="metiz-bonus">Бонусная программа</h2>
        <ul className="metiz-bonus-facts">
          {BONUS_FACTS.map((fact) => (
            <li key={fact.value}>
              <strong>{fact.value}</strong>
              <span>{fact.label}</span>
            </li>
          ))}
        </ul>
        <p className="metiz-bonus-note">{BONUS_NOTE}</p>
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
      slug="metiz-market"
      heroEyebrow="Крепёж и инструмент · Амурск"
      heroTitle="Крепёж, метизы и инструмент в Амурске"
      heroLead="Крепёж, метизы, ручной и электроинструмент, расходные материалы — в магазине «Метиз Маркет» на проспекте Победы, 16."
      nameInPrepositional="Метиз Маркете"
      assortmentHeading="Что можно найти в «Метиз Маркете»"
      showAbout={false}
      heroContactActions
      featuredSections={<MetizMarketFeaturedSections />}
      contactHeading="Метиз Маркет в Амурске"
      contactNote={CONTACT_NOTE}
      contactCallAction
      contactsHref="/kontakty/"
    />
  );
}
