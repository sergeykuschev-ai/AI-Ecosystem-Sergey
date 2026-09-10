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
  title: "Вентиль — магазин сантехники в Амурске | Проспект Победы, 16",
  description:
    "Магазин сантехники «Вентиль» в Амурске: сантехника, водоснабжение, отопление, арматура, смесители, канализация и расходные материалы. Проспект Победы, 16.",
  path: "/ventil/",
});

const DIRECTION_CARDS = [
  {
    title: "Сантехника",
    text: "Раковины, унитазы, пьедесталы, сиденья, ванны, душевые кабины и аксессуары для ванной комнаты — для замены отдельных элементов или обновления санузла.",
  },
  {
    title: "Водоснабжение",
    text: "Трубы и фитинги, гибкие подводки, насосы, фильтры и запорная арматура для разводки холодной и горячей воды.",
  },
  {
    title: "Отопление",
    text: "Радиаторы и секции, краны для спуска воздуха, трубы, фитинги и комплектующие для ремонта и замены участков системы отопления.",
  },
  {
    title: "Арматура",
    text: "Шаровые краны, вентили, обратные клапаны, американки, угольники и переходники — запорная и соединительная арматура в распространённых диаметрах и резьбах.",
  },
  {
    title: "Расходные материалы",
    text: "Прокладки и уплотнения, лён и пасты, герметики, сантехническая лента, сифоны и мелкий крепёж — всё, что нужно для аккуратной установки.",
  },
];

const ASSIST_TITLE = "Поможем подобрать совместимое";

const ASSIST_TEXT =
  "Расскажите продавцу-консультанту, что нужно заменить или собрать: поможем подобрать товары, которые подходят друг к другу по диаметрам, резьбам и типам соединений. Магазин не выполняет инженерные расчёты — точные параметры вашей системы лучше сверить с документацией или проектом.";

const BONUS_FACTS = [
  { value: BONUS_EARN_RATE, label: "начисляем бонусами" },
  { value: BONUS_SPEND_CAP_LABEL, label: "можно оплатить бонусами" },
  { value: BONUS_VALIDITY_LABEL, label: "срок действия бонусов" },
];

const BONUS_NOTE = `Бонусная карта в «Вентиле» выдаётся при покупке от ${formatRubles(BONUS_CARD_THRESHOLDS_RUB.ventil)}.`;

function VentilFeaturedSections() {
  return (
    <>
      <section className="brand-landing-section" aria-labelledby="ventil-directions">
        <h2 id="ventil-directions">Сантехника, водоснабжение и отопление</h2>
        <div className="ventil-feature-grid">
          {DIRECTION_CARDS.map((card) => (
            <article className="ventil-feature-card" key={card.title}>
              <h3>{card.title}</h3>
              <p>{card.text}</p>
            </article>
          ))}
          <div className="ventil-assist-panel">
            <h3>{ASSIST_TITLE}</h3>
            <p>{ASSIST_TEXT}</p>
          </div>
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
      heroTitle="Сантехника, водоснабжение и отопление в Амурске"
      heroLead="Магазин сантехники на проспекте Победы, 16: сантехника, водоснабжение, отопление, арматура, смесители, канализация и расходные материалы — с подбором совместимых комплектующих."
      nameInPrepositional="Вентиле"
      assortmentHeading="Что можно найти в «Вентиле»"
      showAbout={false}
      heroContactActions
      featuredSections={<VentilFeaturedSections />}
      contactHeading="Вентиль в Амурске"
      contactCallAction
      contactsHref="/kontakty/"
      cityStoresHref="/stores/amursk/"
    />
  );
}
