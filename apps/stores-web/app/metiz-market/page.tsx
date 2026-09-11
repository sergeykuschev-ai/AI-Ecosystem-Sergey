import type { Metadata } from "next";
import Link from "next/link";
import { BrandLandingPage } from "@/components/brand/BrandLandingPage";
import {
  BONUS_CARD_THRESHOLDS_RUB,
  BONUS_EARN_RATE,
  BONUS_SPEND_CAP_LABEL,
  BONUS_VALIDITY_LABEL,
  formatRubles,
} from "@/lib/constants/bonus";
import { createPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createPageMetadata({
  title: "Метиз Маркет — крепёж, метизы и инструмент в Амурске",
  description:
    "Магазин «Метиз Маркет» в Амурске: крепёж, метизы, ручной и электроинструмент, расходные материалы для ремонта и монтажа. Адрес: проспект Победы, 16.",
  path: "/metiz-market/",
});

const REPAIR_MOUNTING_TEXT =
  "Направления магазина: ручной и электроинструмент, а также расходные материалы для ремонта и монтажа.";

const FASTENERS_CONSUMABLES_TEXT =
  "К направлению крепежа и метизов относятся саморезы, болты, гайки, анкеры и дюбели.";

const BONUS_FACTS = [
  { value: BONUS_EARN_RATE, label: "начисляем бонусами" },
  { value: BONUS_SPEND_CAP_LABEL, label: "можно оплатить бонусами" },
  { value: BONUS_VALIDITY_LABEL, label: "срок действия бонусов" },
];

const BONUS_NOTE = `Бонусная карта в «Метиз Маркете» выдаётся при покупке от ${formatRubles(BONUS_CARD_THRESHOLDS_RUB["metiz-market"])}.`;

const CONTACT_NOTE =
  "Основные направления: крепёж, метизы, ручной и электроинструмент, расходные материалы для ремонта и монтажа.";

function MetizMarketFeaturedSections() {
  return (
    <>
      <section className="brand-landing-section" aria-labelledby="metiz-directions">
        <h2 id="metiz-directions">Крепёж, инструмент и товары для ремонта</h2>
        <div className="metiz-feature-grid">
          <article className="metiz-feature-card">
            <h3>Для ремонта и монтажа</h3>
            <p>{REPAIR_MOUNTING_TEXT}</p>
          </article>
          <article className="metiz-feature-card">
            <h3>Крепёж и расходные материалы</h3>
            <p>{FASTENERS_CONSUMABLES_TEXT}</p>
          </article>
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
