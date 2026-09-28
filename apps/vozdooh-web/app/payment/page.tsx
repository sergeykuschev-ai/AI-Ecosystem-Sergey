import type { Metadata } from 'next'
import { InfoPage, OwnerBlock } from '../../components/InfoPage'

export const metadata: Metadata = {
  title: 'Оплата — VOZDOOH',
  description: 'Оплата заказов VOZDOOH. Онлайн-оплата на сайте не проводится; способ оплаты согласуется после подтверждения заявки.',
  robots: { index: false, follow: false },
}

export default function PaymentPage() {
  return (
    <InfoPage
      eyebrow="Оплата"
      title="Как оплатить заказ"
      lead="Онлайн-оплата на сайте VOZDOOH сейчас не проводится. Отправка заявки не списывает деньги и не создаёт платёж."
    >
      <section className="infoSection">
        <h2>Что важно знать</h2>
        <ul className="infoList">
          <li>Заявка на сайте — это запрос на подтверждение наличия и условий, а не оплаченный заказ.</li>
          <li>Способ оплаты согласуется с вами после подтверждения заявки.</li>
          <li>Сумма заявки на сайте включает только стоимость товаров. Стоимость доставки, если она применима, сообщается отдельно.</li>
        </ul>
      </section>
      <OwnerBlock label="Доступные способы оплаты" >
        <p>Например: оплата при получении, перевод по реквизитам или иные способы — будут перечислены здесь после подтверждения владельцем.</p>
      </OwnerBlock>
      <OwnerBlock label="Условия оплаты и момент перехода права собственности" />
      <OwnerBlock label="Выдача чеков и документов" />
      <section className="infoSection">
        <h2>Безопасность</h2>
        <p>Сайт не принимает и не хранит данные банковских карт. Никогда не сообщайте реквизиты карты по телефону или в переписке — VOZDOOH не запрашивает такие данные.</p>
      </section>
    </InfoPage>
  )
}
