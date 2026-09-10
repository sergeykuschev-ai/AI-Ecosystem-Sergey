import type { Metadata } from "next";
import Link from "next/link";
import { BrandLandingPage } from "@/components/brand/BrandLandingPage";
import { createPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createPageMetadata({
  title: "Вентиль — магазин сантехники в Амурске | Проспект Победы, 16",
  description:
    "Магазин сантехники «Вентиль» в Амурске: сантехника, водоснабжение, отопление, арматура, смесители, канализация и расходные материалы. Адрес: проспект Победы, 16.",
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
      <section className="brand-landing-section" aria-label="Основные направления ассортимента">
        <div className="ventil-feature-grid">
          {DIRECTION_CARDS.map((card) => (
            <article className="ventil-feature-card" key={card.title}>
              <h2>{card.title}</h2>
              <p>{card.text}</p>
            </article>
          ))}
          <div className="ventil-assist-panel">
            <h2>{ASSIST_TITLE}</h2>
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
      contactNote={CONTACT_NOTE}
      contactCallAction
      contactsHref="/kontakty/"
    />
  );
}
