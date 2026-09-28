import type { Metadata } from "next";
import Link from "next/link";
import { StaticPage } from "@/components/content/StaticPage";
import { VOZDOOH_LEGAL_NAME } from "@/lib/vozdooh/merchant";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Доставка заказов интернет-магазина VOZDOOH",
  description:
    "Способы доставки заказов, статус подключения Ozon Доставки и планируемой доставки Яндекса по Хабаровску, порядок получения заказа после оплаты.",
  path: "/dostavka/",
});

export default function DeliveryPage() {
  return (
    <StaticPage
      eyebrow="Интернет-магазин VOZDOOH"
      title="Доставка"
      intro="На этой странице описано, как покупатель получает заказ после оплаты: способы доставки, их текущий статус и порядок передачи заказа."
    >
      <section className="section" aria-labelledby="delivery-status">
        <h2 id="delivery-status">Текущий статус</h2>
        <p>
          Интернет-магазин VOZDOOH (продавец — {VOZDOOH_LEGAL_NAME}) готовится к запуску, поэтому
          доставка заказов пока не подключена и заказы не принимаются. Магазин подаёт заявки на
          подключение служб доставки; до завершения подключения и публикации условий покупатель не
          может оформить доставку.
        </p>
      </section>

      <section className="section" aria-labelledby="delivery-methods">
        <h2 id="delivery-methods">Способы доставки</h2>
        <ul>
          <li>
            <strong>Ozon Доставка по России.</strong> Заявка на подключение Ozon Доставки для бизнеса
            находится на рассмотрении. После одобрения и подключения этот способ станет основным
            способом доставки заказов по всей России: заказ будет передаваться в службу доставки Ozon
            и вручаться покупателю курьером или через пункт выдачи.
          </li>
          <li>
            <strong>Экспресс-доставка по Хабаровску.</strong> Планируется подключение доставки
            Яндекса для быстрой доставки заказов по Хабаровску.
          </li>
        </ul>
        <p className="note">
          Стоимость доставки, сроки по каждому способу и география будут опубликованы на этой
          странице до начала продаж.
        </p>
      </section>

      <section className="section" aria-labelledby="delivery-process">
        <h2 id="delivery-process">Как покупатель получает заказ после оплаты</h2>
        <ol>
          <li>После оплаты заказа сотрудник магазина собирает заказ и передаёт его в выбранную службу доставки.</li>
          <li>Покупатель получает подтверждение с информацией о передаче заказа и способом отслеживания.</li>
          <li>Курьерская служба доставляет заказ по указанному адресу или в пункт выдачи и уведомляет покупателя.</li>
          <li>Покупатель получает заказ и проверяет комплектность в соответствии с условиями, которые будут опубликованы до начала продаж.</li>
        </ol>
        <p>
          Если заказ не будет передан в доставку в опубликованный срок, покупатель сможет обратиться
          по контактам, указанным на странице <Link href="/rekvizity/">реквизитов</Link>.
        </p>
      </section>

      <section className="section prose" aria-labelledby="delivery-more">
        <h2 id="delivery-more">См. также</h2>
        <ul>
          <li><Link href="/oplata/">Оплата: процесс и защита платежей</Link></li>
          <li><Link href="/vozvrat/">Возврат и обмен товаров</Link></li>
          <li><Link href="/oferta/">Публичная оферта (проект)</Link></li>
        </ul>
      </section>
    </StaticPage>
  );
}
