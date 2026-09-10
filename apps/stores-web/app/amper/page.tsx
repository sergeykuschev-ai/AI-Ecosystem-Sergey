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
  title: "Ампер — магазин электротоваров в Амурске | Проспект Победы, 16",
  description:
    "Магазин электротоваров «Ампер» в Амурске: товары для электромонтажа, освещение, электроинструмент и расходные материалы. Адрес: проспект Победы, 16.",
  path: "/amper/",
});

const SINCE_2018_TEXT =
  "Магазин электротоваров «Ампер» работает в Амурске с 2018 года. Здесь можно подобрать товары для ремонта, замены электрики и повседневных хозяйственных задач — от электротоваров и товаров для электромонтажа до освещения, электроинструмента и расходных материалов.";

const DIRECTIONS = [
  {
    title: "Кабель и провод",
    text: "Провода, кабели и соединительные товары для замены проводки и хозяйственных задач — с подсказкой, какие характеристики важно знать перед покупкой.",
  },
  {
    title: "Автоматика и защита",
    text: "Автоматические выключатели, дифференциальные устройства, модульное оборудование и всё для обновления электрощита.",
  },
  {
    title: "Освещение",
    text: "Лампы, светильники и комплектующие для квартиры, дома и дачи: поможем подобрать варианты под ваше помещение.",
  },
  {
    title: "Инструмент и расходные материалы",
    text: "Электроинструмент, изолента, клеммы, гофра, подрозетники и монтажные коробки — мелочи, без которых ремонт не начинается.",
  },
];

const ASSIST_ITEMS = [
  "Подберём кабель, автоматику и освещение под описанную вами задачу.",
  "Подскажем, какие характеристики стоит уточнить у электрика или по проекту.",
  "Соберём сопутствующие товары: изоляция, клеммы, гофра, подрозетники, крепёж.",
];

const ASSIST_NOTE =
  "Мы не выполняем проектные электротехнические расчёты: сечение кабеля и номиналы защитных устройств подтверждает проект или электрик.";

const BONUS_FACTS = [
  { value: BONUS_EARN_RATE, label: "начисляем бонусами" },
  { value: BONUS_SPEND_CAP_LABEL, label: "можно оплатить бонусами" },
  { value: BONUS_VALIDITY_LABEL, label: "срок действия бонусов" },
];

const BONUS_NOTE = `Бонусная карта в «Ампере» выдаётся при покупке от ${formatRubles(BONUS_CARD_THRESHOLDS_RUB.amper)}.`;

const CONTACT_NOTE =
  "В «Ампере» можно купить товары для электромонта, освещение, электроинструмент и расходные материалы. Магазин находится в центре Амурска: рядом автобусные остановки, удобно добираться пешком.";

function AmperFeaturedSections() {
  return (
    <>
      <section className="brand-landing-section" aria-label="О магазине">
        <div className="amper-info-grid">
          <article className="amper-info-card">
            <div className="amper-info-card__year">
              <strong>2018</strong>
              <span>с 2018 года</span>
            </div>
            <h2>«Ампер» работает в Амурске с 2018 года</h2>
            <p>{SINCE_2018_TEXT}</p>
          </article>
          <article className="amper-info-card">
            <h2>Основные направления</h2>
            <p>
              Электротовары и товары для электромонтажа, освещение, электроинструмент и расходные
              материалы — основные направления ассортимента «Ампера».
            </p>
          </article>
        </div>
      </section>

      <section className="brand-landing-section" aria-labelledby="amper-directions">
        <p className="eyebrow">Категории</p>
        <h2 id="amper-directions">Электрика и расходные материалы</h2>
        <div className="amper-feature-grid">
          {DIRECTIONS.map((direction) => (
            <article className="amper-feature-card" key={direction.title}>
              <h3>{direction.title}</h3>
              <p>{direction.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="brand-landing-section brand-landing-section--compact" aria-labelledby="amper-assistance">
        <div className="amper-assist-panel">
          <h2 id="amper-assistance">Поможем подобрать нужное</h2>
          <ul className="amper-assist-list">
            {ASSIST_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="amper-assist-note">{ASSIST_NOTE}</p>
        </div>
      </section>

      <section className="brand-landing-section" aria-labelledby="amper-bonus">
        <div className="amper-bonus-panel">
          <h2 id="amper-bonus">Бонусная программа</h2>
          <ul className="amper-bonus-facts">
            {BONUS_FACTS.map((fact) => (
              <li key={fact.value}>
                <strong>{fact.value}</strong>
                <span>{fact.label}</span>
              </li>
            ))}
          </ul>
          <p className="amper-bonus-note">{BONUS_NOTE}</p>
          <div className="button-row">
            <Link className="button button--secondary" href="/bonus/">
              Подробнее о бонусной программе
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

export default function Page() {
  return (
    <BrandLandingPage
      slug="amper"
      heroEyebrow="Ампер"
      heroTitle="«Ампер» — магазин электротоваров в Амурске"
      heroLead="Электротовары, товары для электромонтажа, освещение, электроинструмент и расходные материалы — в магазине «Ампер» на проспекте Победы, 16."
      nameInPrepositional="Ампере"
      assortmentHeading="Что можно найти в «Ампере»"
      showAbout={false}
      heroContactActions
      featuredSections={<AmperFeaturedSections />}
      contactHeading="Ампер в Амурске"
      contactNote={CONTACT_NOTE}
      contactCallAction
      contactsHref="/kontakty/"
      cityStoresHref="/stores/amursk/"
    />
  );
}
