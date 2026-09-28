import type { Metadata } from "next";
import Link from "next/link";
import { StaticPage } from "@/components/content/StaticPage";
import { VOZDOOH_LEGAL_NAME, VOZDOOH_MERCHANT, VOZDOOH_PENDING_REQUISITES_TEXT } from "@/lib/vozdooh/merchant";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Реквизиты интернет-магазина VOZDOOH",
  description:
    "Сведения о продавце интернет-магазина VOZDOOH: наименование, город, контактный телефон и адрес электронной почты.",
  path: "/rekvizity/",
});

export default function RequisitesPage() {
  return (
    <StaticPage
      eyebrow="Интернет-магазин VOZDOOH"
      title="Реквизиты"
      intro="Здесь опубликованы сведения о продавце, размещающем информацию на этом сайте."
    >
      <section className="section" aria-labelledby="requisites-seller">
        <h2 id="requisites-seller">Сведения о продавце</h2>
        <div className="contact-block">
          <dl>
            <div>
              <dt>Торговое наименование</dt>
              <dd>{VOZDOOH_MERCHANT.storeName}</dd>
            </div>
            <div>
              <dt>Продавец</dt>
              <dd>{VOZDOOH_LEGAL_NAME}</dd>
            </div>
            <div>
              <dt>Страна регистрации</dt>
              <dd>{VOZDOOH_MERCHANT.country}</dd>
            </div>
            <div>
              <dt>Город</dt>
              <dd>{VOZDOOH_MERCHANT.city}</dd>
            </div>
            <div>
              <dt>Электронная почта</dt>
              <dd><a href={`mailto:${VOZDOOH_MERCHANT.email}`}>{VOZDOOH_MERCHANT.email}</a></dd>
            </div>
            <div>
              <dt>Телефон</dt>
              <dd><a href={VOZDOOH_MERCHANT.phoneHref}>{VOZDOOH_MERCHANT.phone}</a></dd>
            </div>
          </dl>
        </div>
        <p className="note">{VOZDOOH_PENDING_REQUISITES_TEXT}</p>
      </section>

      <section className="section prose" aria-labelledby="requisites-more">
        <h2 id="requisites-more">Где найти дополнительную информацию</h2>
        <ul>
          <li><Link href="/oplata/">Как будет проходить оплата и как защищаются платежи</Link></li>
          <li><Link href="/dostavka/">Способы и статус подключения доставки</Link></li>
          <li><Link href="/vozvrat/">Возврат и обмен товаров</Link></li>
          <li><Link href="/oferta/">Публичная оферта (проект)</Link></li>
          <li><Link href="/politika-konfidencialnosti/">Политика конфиденциальности (проект)</Link></li>
          <li><Link href="/kontakty/">Контакты магазинов</Link></li>
        </ul>
      </section>
    </StaticPage>
  );
}
