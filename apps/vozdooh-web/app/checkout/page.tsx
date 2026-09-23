import { catalogSource, getCatalogRepository } from '../../src/catalog/source'

import type { Metadata } from 'next'
import { CheckoutForm } from '../../components/CheckoutForm'
import { SiteFooter } from '../../components/SiteFooter'
import { SiteHeader } from '../../components/SiteHeader'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Оформление заказа — VOZDOOH',
  description: 'Демонстрационный сценарий оформления заказа VOZDOOH. Заказы не создаются до подключения 1С и платёжного провайдера.',
  robots: { index: false, follow: false },
}

export default async function CheckoutPage() {
  const products = await (await getCatalogRepository()).list()
  const demo = catalogSource() === 'demo'
  return (
    <main>
      <SiteHeader />
      <section className="pageIntro">
        <span className="eyebrow">Оформление</span>
        <h1>Проверьте выбор</h1>
        <p>Сценарий оформления подготовлен без фиктивной оплаты и без создания заказов: кнопка отправки останется неактивной до подключения 1С и платёжного провайдера.</p>
      </section>
      <CheckoutForm products={products} demo={demo} />
      <SiteFooter />
    </main>
  )
}
