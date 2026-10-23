import { catalogSource, getCatalogRepository } from '../../src/catalog/source'

import type { Metadata } from 'next'
import { CheckoutForm } from '../../components/CheckoutForm'
import { SiteFooter } from '../../components/SiteFooter'
import { SiteHeader } from '../../components/SiteHeader'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Оформление заказа — VOZDOOH',
  description: 'Оформление заказа VOZDOOH с оплатой через Ozon Pay.',
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
        <p>Проверьте товары и контактные данные. После сохранения заявки можно перейти к оплате через Ozon Pay.</p>
      </section>
      <CheckoutForm products={products} enabled={enabled} />
      <SiteFooter />
    </main>
  )
}
