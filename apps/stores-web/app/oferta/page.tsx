import type { Metadata } from "next";
import Link from "next/link";
import { StaticPage } from "@/components/content/StaticPage";
import { VOZDOOH_LEGAL_NAME, VOZDOOH_PENDING_REQUISITES_TEXT } from "@/lib/vozdooh/merchant";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Публичная оферта интернет-магазина VOZDOOH",
  description: "Проект публичной оферты интернет-магазина VOZDOOH. Документ вступит в силу после утверждения и публикации финальной редакции.",
  path: "/oferta/",
  noIndex: true,
});

export default function OfferPage() {
  return (
    <StaticPage
      eyebrow="Интернет-магазин VOZDOOH"
      title="Публичная оферта"
      intro="Публичная оферта интернет-магазина VOZDOOH на продаже товаров дистанционным способом."
    >
      <section className="section" aria-labelledby="offer-status">
        <h2 id="offer-status">Статус документа</h2>
        <p><span className="status-warning">Проект</span></p>
        <p>
          Этот текст является проектом публичной оферты. Он готовится к утверждению продавцом и
          вступит в силу с момента публикации финальной редакции на этой странице. До утверждения
          документ не является публичной офертой и используется для подготовки магазина к запуску
          и проверки платёжного партнёра. Страница исключена из поисковой индексации до утверждения.
        </p>
      </section>

      <section className="section prose" aria-labelledby="offer-terms">
        <h2 id="offer-terms">Структура будущей оферты</h2>
        <ol>
          <li>
            <strong>Общие положения.</strong> Документ определяет условия продажи товаров
            интернет-магазином VOZDOOH покупателям — физическим лицам, оформляющим заказ на сайте.
          </li>
          <li>
            <strong>Предмет.</strong> Продавец обязуется передать покупателю товар, а покупатель —
            принять и оплатить его на условиях оферты.
          </li>
          <li>
            <strong>Оформление заказа.</strong> Порядок оформления заказа на сайте, подтверждение
            заказа сотрудником магазина и сведения о заказе, которые сообщает покупатель.
          </li>
          <li>
            <strong>Цена и оплата.</strong> Цена товара указывается на странице товара. Оплата
            производится через интернет-эквайринг Ozon Банка после его подключения; подробное
            описание процесса оплаты — на странице <Link href="/oplata/">«Оплата»</Link>.
          </li>
          <li>
            <strong>Доставка.</strong> Способы, сроки и стоимость доставки описываются на странице
            <Link href="/dostavka/">«Доставка»</Link>; после подключения служб доставки условия
            будут закреплены в оферте.
          </li>
          <li>
            <strong>Возврат и обмен.</strong> Права покупателя на возврат и обмен товара и порядок
            возврата денежных средств — на странице <Link href="/vozvrat/">«Возврат и обмен»</Link>.
          </li>
          <li>
            <strong>Реквизиты продавца.</strong> Продавец — {VOZDOOH_LEGAL_NAME}.
            Актуальные реквизиты публикуются на странице <Link href="/rekvizity/">«Реквизиты»</Link>.
          </li>
          <li>
            <strong>Конфиденциальность.</strong> Обработка персональных данных покупателя описывается
            в <Link href="/politika-konfidencialnosti/">политике конфиденциальности</Link>.
          </li>
        </ol>
        <p className="note">{VOZDOOH_PENDING_REQUISITES_TEXT}</p>
      </section>
    </StaticPage>
  );
}
