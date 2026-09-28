import type { Metadata } from "next";
import Link from "next/link";
import { StaticPage } from "@/components/content/StaticPage";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Доставка и получение заказа | Магазины Ампер, Вентиль, Метиз Маркет и Миска",
  description:
    "Как получить товар: самовывоз из магазинов Ампер, Вентиль, Метиз Маркет и Миска в Амурске уже работает, а доставка заказов подключается отдельным этапом.",
  path: "/delivery/",
});

export default function DeliveryPage() {
  return (
    <StaticPage
      className="delivery-page"
      eyebrow="Покупателям"
      title="Доставка и получение заказа"
      intro="Способы получения товара: самовывоз из магазинов в Амурске работает сегодня, доставка заказов подключается отдельным этапом."
    >
      <section className="section prose" aria-labelledby="delivery-pickup">
        <h2 id="delivery-pickup">Самовывоз из магазинов в Амурске</h2>
        <p>
          Все четыре магазина — «Ампер», «Вентиль», «Метиз Маркет» и «Миска» — находятся по адресу:
          г. Амурск, проспект Победы, 16. Оплаченный в магазине товар выдаётся сразу, в день покупки.
          Актуальный режим работы опубликован на странице контактов.
        </p>
        <p><Link href="/kontakty/">Контакты, адреса и телефоны магазинов</Link></p>
      </section>

      <section className="section prose" aria-labelledby="delivery-planned">
        <h2 id="delivery-planned">Доставка заказов — в планах</h2>
        <p>
          Доставка заказов по Амурску, Хабаровскому краю и другим регионам России планируется и подключается
          отдельным этапом. Подключённая служба доставки, география, сроки и стоимость будут опубликованы на этой
          странице сразу после подтверждения условий — мы не заявляем сроки и тарифы заранее.
        </p>
      </section>

      <section className="section prose" aria-labelledby="delivery-after-payment">
        <h2 id="delivery-after-payment">Получение заказа после оплаты</h2>
        <p>
          Сегодня заказ можно получить только при личном визите в магазин — сразу после оплаты на месте. После запуска
          доставки способ получения (курьером или в пункте выдачи) и сроки будут показаны при оформлении заказа и
          продублированы в подтверждении заказа.
        </p>
      </section>

      <section className="section" aria-labelledby="delivery-links">
        <h2 id="delivery-links">Полезные разделы</h2>
        <ul className="link-list">
          <li><Link href="/payment/">Порядок оплаты</Link></li>
          <li><Link href="/kontakty/">Контакты, адреса и телефоны магазинов</Link></li>
          <li><Link href="/faq/">Частые вопросы</Link></li>
        </ul>
      </section>
    </StaticPage>
  );
}
