import type { Metadata } from "next";
import Link from "next/link";
import { BrandLandingPage } from "@/components/brand/BrandLandingPage";
import { createPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createPageMetadata({
  title: "Миска — зоомагазин в Амурске | Корма и товары для питомцев",
  description:
    "Зоомагазин «Миска» в Амурске: корма для собак и кошек, ветеринарные и монопротеиновые рационы, лакомства, товары для ухода и одежда для собак.",
  path: "/miska/",
});

const NUTRITION_TEXT =
  "В «Миске» представлены обычные корма, ветеринарные рационы и монопротеиновые корма для собак и кошек. Это позволяет подобрать питание с учётом индивидуальных особенностей питомца, в том числе при аллергии или пищевой непереносимости. При выборе специализированного рациона ориентируйтесь на рекомендации ветеринарного врача. Среди специализированных линеек в магазине представлена AWARD Veterinary Diet.";

const CLOTHING_TEXT =
  "В магазине представлен выбор одежды для собак на прохладную и холодную погоду — демисезонные и зимние модели.";

const ASSISTANCE_TEXT =
  "В магазине работают продавцы-консультанты, которые помогут сориентироваться в ассортименте и подобрать подходящий товар.";

const BONUS_FACTS = [
  { value: "5%", label: "начисляем бонусами" },
  { value: "до 15%", label: "можно оплатить бонусами" },
  { value: "3 месяца", label: "срок действия бонусов" },
];

const BONUS_NOTE = "Бонусная карта в «Миске» выдаётся при покупке от 2 000 ₽.";

function MiskaFeaturedSections() {
  return (
    <>
      <section className="brand-landing-section" aria-label="Главные направления">
        <div className="miska-feature-grid">
          <article className="miska-feature-card">
            <h2>Питание с учётом особенностей питомца</h2>
            <p>{NUTRITION_TEXT}</p>
          </article>
          <article className="miska-feature-card">
            <h2>Одежда для собак</h2>
            <p>{CLOTHING_TEXT}</p>
          </article>
        </div>
      </section>

      <section className="brand-landing-section brand-landing-section--compact" aria-labelledby="miska-assistance">
        <h2 id="miska-assistance">Поможем с выбором</h2>
        <p>{ASSISTANCE_TEXT}</p>
      </section>

      <section className="brand-landing-section" aria-labelledby="miska-bonus">
        <h2 id="miska-bonus">Бонусная программа</h2>
        <ul className="miska-bonus-facts">
          {BONUS_FACTS.map((fact) => (
            <li key={fact.value}>
              <strong>{fact.value}</strong>
              <span>{fact.label}</span>
            </li>
          ))}
        </ul>
        <p className="miska-bonus-note">{BONUS_NOTE}</p>
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
      slug="miska"
      heroEyebrow="Миска"
      heroTitle="Зоотовары для собак и кошек в Амурске"
      heroLead="Корма, лакомства, ветеринарные рационы, товары для ухода и одежда для питомцев — в магазине «Миска» на проспекте Победы, 16."
      nameInPrepositional="Миске"
      assortmentHeading="Что можно найти в «Миске»"
      assortmentExtra={["Одежда для собак"]}
      aboutHeading="«Миска» — зоомагазин в Амурске"
      showAbout={false}
      heroContactActions
      featuredSections={<MiskaFeaturedSections />}
    />
  );
}
