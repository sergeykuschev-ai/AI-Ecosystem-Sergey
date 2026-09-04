import type { Metadata } from "next";
import Link from "next/link";
import { BrandLandingPage } from "@/components/brand/BrandLandingPage";
import { createPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createPageMetadata({
  title: "Ампер — магазин электротоваров в Амурске | Проспект Победы, 16",
  description:
    "Магазин электротоваров «Ампер» в Амурске: электротовары, товары для электромонтажа, освещение, электроинструмент и расходные материалы. Адрес: проспект Победы, 16.",
  path: "/amper/",
});

const SINCE_2018_TEXT =
  "Магазин электротоваров «Ампер» работает в Амурске с 2018 года. Здесь можно подобрать товары для ремонта, замены электрики и повседневных хозяйственных задач — от электротоваров и товаров для электромонтажа до освещения, электроинструмента и расходных материалов.";

const ASSISTANCE_TEXT =
  "В магазине работают продавцы-консультанты: помогут сориентироваться в ассортименте и подобрать товар под вашу задачу.";

const BONUS_FACTS = [
  { value: "5%", label: "начисляем бонусами" },
  { value: "до 15%", label: "можно оплатить бонусами" },
  { value: "3 месяца", label: "срок действия бонусов" },
];

const BONUS_NOTE = "Бонусная карта в «Ампере» выдаётся при покупке от 3 500 ₽.";

const CONTACT_NOTE =
  "Магазин находится в центре Амурска: рядом автобусные остановки, удобно добираться пешком.";

function AmperFeaturedSections() {
  return (
    <>
      <section className="brand-landing-section" aria-label="О магазине и помощь с выбором">
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
            <h2>Поможем подобрать нужное</h2>
            <p>{ASSISTANCE_TEXT}</p>
          </article>
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
      heroTitle="Электротовары для дома и ремонта в Амурске"
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
    />
  );
}
