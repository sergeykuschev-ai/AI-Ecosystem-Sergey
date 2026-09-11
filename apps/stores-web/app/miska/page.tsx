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
  title: "МИСКА ЗООМАГАЗИН — зоотовары в Амурске",
  description:
    "Зоомагазин «Миска» в Амурске на проспекте Победы, 16: корма для собак и кошек, лакомства, наполнители, товары для ухода, игрушки, амуниция, витамины и добавки.",
  path: "/miska/",
});

const HERO_POINTS = [
  "Корма и товары для кошек и собак — от повседневных рационов до специализированного питания",
  "Лакомства, наполнители, уход, игрушки и амуниция в одном магазине",
  `Бонусная карта: начисляем ${BONUS_EARN_RATE}, выдаётся при покупке от ${formatRubles(BONUS_CARD_THRESHOLDS_RUB.miska)}`,
];

const CATEGORY_BLOCKS = [
  {
    title: "Корма",
    text: "Сухие и влажные корма для кошек и собак на каждый день, а также монопротеиновые и гипоаллергенные варианты для питомцев с чувствительным пищеварением. Ветеринарные диетические рационы применяются по рекомендации ветеринарного врача.",
  },
  {
    title: "Лакомства",
    text: "Лакомства для поощрения и дрессировки собак, лакомства-крем и мясные снеки для кошек, а также функциональные варианты — например, для поддержания гигиены полости рта.",
  },
  {
    title: "Наполнители и туалеты",
    text: "Комкующиеся, древесные и силикагелевые наполнители, лотки, совки и средства для уборки — всё для чистого туалета кошки и удобной прогулки с собакой.",
  },
  {
    title: "Уход",
    text: "Шампуни и кондиционеры, средства для ушей и глаз, когтерезки, расчёски и щётки, впитывающие пелёнки и салфетки для ежедневного ухода за питомцем.",
  },
  {
    title: "Игрушки",
    text: "Мячики, канаты, удочки-дразнилки и интерактивные игрушки, которые помогают питомцу оставаться активным и занятым, а также когтеточки для кошек.",
  },
  {
    title: "Амуниция",
    text: "Ошейники, поводки, шлейки, намордники, переноски и миски для кормления. Для прогулок в прохладную погоду — демисезонная и зимняя одежда для собак.",
  },
  {
    title: "Витамины и добавки",
    text: "Добавки для поддержки иммунитета, суставов, шерсти и пищеварения кошек и собак. Перед применением любой добавки проконсультируйтесь с ветеринарным врачом.",
  },
  {
    title: "Товары для кошек и собак",
    text: "Отдельно собранные полки по видам питомцев: для кошек — лотки, когтеточки и переноски, для собак — лежанки, миски и товары для прогулок. Так проще найти нужное.",
  },
];

const SELECTION_TIPS = [
  "Вид питомца, порода и размер",
  "Возраст: щенок или котёнок, взрослое животное, питомец старше 7 лет",
  "Вес, активность и особенности пищеварения",
  "Предпочтения питомца и ваш бюджет",
];

const NUTRITION_TEXT =
  "В «Миске» представлены обычные корма, монопротеиновые и гипоаллергенные рационы для собак и кошек, в том числе для питомцев с чувствительным пищеварением. Среди специализированных линеек в магазине представлена AWARD Veterinary Diet. Лечебные и диетические рационы применяются по назначению ветеринарного врача — если у вас уже есть рекомендация врача, расскажите о ней продавцу, и мы поможем найти подходящий товар в ассортименте.";

const CLOTHING_TEXT =
  "В магазине представлен выбор одежды для собак на прохладную и холодную погоду — демисезонные и зимние модели, а также амуниция для комфортных прогулок: шлейки, поводки и ошейники.";

const VET_NOTICE =
  "Команда магазина не ставит диагнозы и не заменяет консультацию ветеринарного врача. По вопросам здоровья питомца обращайтесь в ветеринарную клинику — а в магазине мы поможем подобрать товары с учётом рекомендаций врача.";

const BONUS_FACTS = [
  { value: BONUS_EARN_RATE, label: "начисляем бонусами с каждой покупки" },
  { value: BONUS_SPEND_CAP_LABEL, label: "можно оплатить бонусами" },
  { value: BONUS_VALIDITY_LABEL, label: "срок действия бонусов" },
];

const BONUS_NOTE = `Бонусная карта в «Миске» выдаётся при покупке от ${formatRubles(BONUS_CARD_THRESHOLDS_RUB.miska)}.`;

function MiskaCategoryBlocks() {
  return (
    <section className="brand-landing-section" aria-labelledby="miska-categories">
      <p className="eyebrow">Ассортимент</p>
      <h2 id="miska-categories">Основные категории</h2>
      <div className="miska-category-grid">
        {CATEGORY_BLOCKS.map((block) => (
          <article className="miska-category-card" key={block.title}>
            <h3>{block.title}</h3>
            <p>{block.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function MiskaAssistanceSection() {
  return (
    <section className="brand-landing-section brand-landing-section--compact" aria-labelledby="miska-assistance">
      <h2 id="miska-assistance">Поможем подобрать товар</h2>
      <p>
        Не уверены, какой корм или товар подойдёт питомцу? Продавцы-консультанты «Миски» помогут
        сориентироваться в ассортименте и предложат несколько вариантов. Чем подробнее вы расскажете
        о питомце, тем точнее получится подборка.
      </p>
      <div className="miska-assist-panel">
        <h3>Что учесть при выборе</h3>
        <ul className="miska-assist-list">
          {SELECTION_TIPS.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
        <p className="miska-assist-note">{VET_NOTICE}</p>
      </div>
    </section>
  );
}

function MiskaFeaturedSections() {
  return (
    <>
      <MiskaCategoryBlocks />

      <section className="brand-landing-section" aria-label="Главные направления">
        <div className="miska-feature-grid">
          <article className="miska-feature-card">
            <h2>Питание с учётом особенностей питомца</h2>
            <p>{NUTRITION_TEXT}</p>
          </article>
          <article className="miska-feature-card">
            <h2>Одежда и амуниция для прогулок</h2>
            <p>{CLOTHING_TEXT}</p>
          </article>
        </div>
      </section>

      <MiskaAssistanceSection />

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
      heroEyebrow="МИСКА ЗООМАГАЗИН"
      heroTitle="Зоомагазин и зоотовары в Амурске"
      heroLead="В «Миске» можно купить корм и другие товары для кошек и собак: лакомства, наполнители, товары для ухода, игрушки, амуницию, витамины и добавки."
      heroPoints={HERO_POINTS}
      nameInPrepositional="Миске"
      assortmentHeading="Что можно найти в «Миске»"
      assortmentExtra={["Одежда для собак"]}
      aboutHeading="«Миска» — зоомагазин в Амурске"
      showAbout={false}
      heroContactActions
      featuredSections={<MiskaFeaturedSections />}
      contactHeading="МИСКА ЗООМАГАЗИН в Амурске"
      contactNote="Основные направления: корма для кошек и собак, лакомства, наполнители, уход, игрушки, амуниция, витамины и добавки."
      contactCallAction
      contactsHref="/kontakty/"
      cityStoresHref="/stores/amursk/"
    />
  );
}
