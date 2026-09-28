import type { Metadata } from 'next'
import { InfoPage, OwnerBlock } from '../../components/InfoPage'

export const metadata: Metadata = {
  title: 'Контакты — VOZDOOH',
  description: 'Как связаться с VOZDOOH: телефон, электронная почта, город и реквизиты продавца.',
  robots: { index: false, follow: false },
}

export default function ContactsPage() {
  return (
    <InfoPage
      eyebrow="Контакты"
      title="Связаться с VOZDOOH"
      lead="По вопросам подтверждения заявок, наличия товаров и условий получения заказа звоните или пишите нам."
    >
      <section className="infoSection">
        <h2>Продавец</h2>
        <dl className="infoFacts">
          <div>
            <dt>Наименование</dt>
            <dd>ИП Кущев Сергей Васильевич (интернет-магазин VOZDOOH)</dd>
          </div>
          <div>
            <dt>Страна регистрации</dt>
            <dd>Россия</dd>
          </div>
          <div>
            <dt>Город</dt>
            <dd>Хабаровск</dd>
          </div>
        </dl>
      </section>
      <section className="infoSection">
        <h2>Как с нами связаться</h2>
        <dl className="infoFacts">
          <div>
            <dt>Телефон</dt>
            <dd><a className="textLink" href="tel:+79244199990">+7 924 419-99-90</a></dd>
          </div>
          <div>
            <dt>Электронная почта</dt>
            <dd><a className="textLink" href="mailto:vozdooh.kms@yandex.ru">vozdooh.kms@yandex.ru</a></dd>
          </div>
          <div>
            <dt>Сайт</dt>
            <dd><a className="textLink" href="https://vozdooh27.ru">vozdooh27.ru</a></dd>
          </div>
          <div>
            <dt>Режим работы</dt>
            <dd>Уточняется. Напишите нам — мы ответим на вашу заявку.</dd>
          </div>
        </dl>
        <p>Указывайте в письме номер заявки, если ваш вопрос связан с оформленным заказом.</p>
      </section>
      <OwnerBlock label="Адрес магазина и пункта выдачи" />
      <OwnerBlock label="Реквизиты продавца (ИНН, ОГРНИП, юридический адрес)" />
    </InfoPage>
  )
}
