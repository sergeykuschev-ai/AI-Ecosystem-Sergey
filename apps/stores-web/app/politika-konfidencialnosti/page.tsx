import type { Metadata } from "next";
import Link from "next/link";
import { StaticPage } from "@/components/content/StaticPage";
import { VOZDOOH_LEGAL_NAME, VOZDOOH_MERCHANT } from "@/lib/vozdooh/merchant";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Политика конфиденциальности",
  description: "Проект политики конфиденциальности: какие данные обрабатывает сайт, с какой целью и какие права есть у посетителя.",
  path: "/politika-konfidencialnosti/",
  noIndex: true,
});

export default function PrivacyPage() {
  return (
    <StaticPage
      eyebrow="Интернет-магазин VOZDOOH"
      title="Политика конфиденциальности"
      intro="Какие персональные данные обрабатывает этот сайт, с какой целью и как посетитель может реализовать свои права."
    >
      <section className="section" aria-labelledby="privacy-status">
        <h2 id="privacy-status">Статус документа</h2>
        <p><span className="status-warning">Проект</span></p>
        <p>
          Этот текст является проектом политики конфиденциальности. Он описывает реальные практики
          обработки данных сайта и готовится к утверждению оператором. Документ вступит в силу с
          момента публикации финальной редакции на этой странице; до утверждения страница
          исключена из поисковой индексации.
        </p>
      </section>

      <section className="section prose" aria-labelledby="privacy-operator">
        <h2 id="privacy-operator">Оператор данных</h2>
        <p>
          Оператор персональных данных — {VOZDOOH_LEGAL_NAME} (интернет-магазин VOZDOOH,
          город {VOZDOOH_MERCHANT.city}). Связаться с оператором можно по электронной почте{" "}
          <a href={`mailto:${VOZDOOH_MERCHANT.email}`}>{VOZDOOH_MERCHANT.email}</a> или по телефону{" "}
          <a href={VOZDOOH_MERCHANT.phoneHref}>{VOZDOOH_MERCHANT.phone}</a>.
        </p>
      </section>

      <section className="section prose" aria-labelledby="privacy-data">
        <h2 id="privacy-data">Какие данные обрабатываются</h2>
        <ul>
          <li>Обезличенные данные посещений: страницы просмотров, переходы, тип устройства и браузера. Они собираются счётчиком Яндекс Метрика в целях измерения посещаемости и улучшения работы сайта.</li>
          <li>Файлы cookie и аналогичные технологии, необходимые для работы счётчика аналитики и корректного отображения сайта.</li>
          <li>Данные, которые посетитель добровольно передаёт оператору при обращении по электронной почте или телефону: имя, адрес электронной почты, номер телефона и содержание обращения.</li>
        </ul>
        <p>
          Сайт не публикует форм сбора персональных данных и не передаёт данные посетителей
          третьим лицам, кроме случаев, предусмотренных законодательством РФ, и обработчиков,
          обеспечивающих работу сайта (например, счётчик Яндекс Метрики).
        </p>
      </section>

      <section className="section prose" aria-labelledby="privacy-rights">
        <h2 id="privacy-rights">Права посетителя</h2>
        <p>
          В соответствии со статьёй 152 Гражданского кодекса РФ и Федеральным законом № 152-ФЗ
          «О персональных данных» посетитель вправе запросить уточнение, блокирование или удаление
          своих персональных данных, а также отозвать согласие на их обработку. Для этого достаточно
          направить обращение оператору по контактам, указанным выше.
        </p>
        <p>
          Посетитель может ограничить сбор обезличенных данных, отключив cookie в настройках браузера;
          в этом случае некоторые функции сайта могут работать неполноценно.
        </p>
      </section>

      <section className="section prose" aria-labelledby="privacy-changes">
        <h2 id="privacy-changes">Изменение политики</h2>
        <p>
          Оператор вправе обновлять текст политики; действующая редакция всегда публикуется на этой
          странице. См. также <Link href="/polzovatelskoe-soglashenie/">пользовательское соглашение</Link> и{" "}
          <Link href="/oferta/">публичную оферту (проект)</Link>.
        </p>
      </section>
    </StaticPage>
  );
}
