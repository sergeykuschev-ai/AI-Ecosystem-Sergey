import { catalogSource, getCatalogRepository } from '../../src/catalog/source'

import type { Metadata } from 'next'
import { CheckoutForm } from '../../components/CheckoutForm'
import { SiteFooter } from '../../components/SiteFooter'
import { SiteHeader } from '../../components/SiteHeader'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Оформление заказа — VOZDOOH',
  description: 'Заявка на заказ VOZDOOH для ручной обработки. Без онлайн-оплаты.',
  robots: { index: false, follow: false },
}

export default async function CheckoutPage() {
  const products = await (await getCatalogRepository()).list()
  const enabled = catalogSource() === 'staged-1c'
  return (
    <main>
      <SiteHeader />
      <section className="pageIntro">
        <span className="eyebrow">Оформление</span>
        <h1>Проверьте выбор</h1>
        <p>Отправьте заявку на выбранные товары. Наличие и получение требуют подтверждения. Онлайн-оплата не подключена.</p>
      </section>
      <CheckoutForm products={products} enabled={enabled} />
      <SiteFooter />
    </main>
  )
}
