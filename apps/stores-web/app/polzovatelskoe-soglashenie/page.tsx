import type { Metadata } from "next";
import Link from "next/link";
import { StaticPage } from "@/components/content/StaticPage";
import { VOZDOOH_LEGAL_NAME } from "@/lib/vozdooh/merchant";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Пользовательское соглашение сайта",
  description: "Проект пользовательского соглашения сайта. Документ вступит в силу после утверждения и публикации финальной редакции.",
  path: "/polzovatelskoe-soglashenie/",
  noIndex: true,
});

export default function UserAgreementPage() {
  return (
    <StaticPage
      eyebrow="Интернет-магазин VOZDOOH"
      title="Пользовательское соглашение"
      intro="Условия использования информации и материалов, размещённых на этом сайте."
    >
      <section className="section" aria-labelledby="agreement-status">
        <h2 id="agreement-status">Статус документа</h2>
        <p><span className="status-warning">Проект</span></p>
        <p>
          Этот текст является проектом пользовательского соглашения. Он готовится к утверждению и
          вступит в силу с момента публикации финальной редакции на этой странице. До утверждения
          страница исключена из поисковой индексации.
        </p>
      </section>

      <section className="section prose" aria-labelledby="agreement-terms">
        <h2 id="agreement-terms">Условия использования сайта</h2>
        <ol>
          <li>
            <strong>Информационный характер сайта.</strong> Сайт содержит сведения о магазинах и
            интернет-магазине VOZDOOH, а также справочную информацию для покупателей. Материалы
            сайта носят информационный характер.
          </li>
          <li>
            <strong>Авторские права.</strong> Тексты, изображения и иные материалы сайта принадлежат
            правообладателю ({VOZDOOH_LEGAL_NAME}) либо используются с разрешения правообладателей.
            Копирование материалов без согласия правообладателя не допускается.
          </li>
          <li>
            <strong>Допустимое использование.</strong> Пользователь обязуется не использовать сайт
            для размещения или рассылки незаконного содержимого, не вмешиваться в работу сайта и не
            пытаться получить несанкционированный доступ к его данным.
          </li>
          <li>
            <strong>Точность сведений.</strong> Владелец сайта стремится поддерживать актуальность
            размещённой информации, однако условия продажи, доставки и оплаты фиксируются
            утверждёнными документами: <Link href="/oferta/">публичной офертой</Link>,
            страницами <Link href="/oplata/">«Оплата»</Link> и <Link href="/dostavka/">«Доставка»</Link>.
          </li>
          <li>
            <strong>Изменение соглашения.</strong> Владелец сайта вправе обновлять текст соглашения;
            действующая редакция всегда публикуется на этой странице.
          </li>
          <li>
            <strong>Контакты.</strong> Вопросы о работе сайта можно направить по контактам на странице
            <Link href="/rekvizity/">«Реквизиты»</Link>.
          </li>
        </ol>
      </section>
    </StaticPage>
  );
}
