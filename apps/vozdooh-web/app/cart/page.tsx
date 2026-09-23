import { catalogSource, getCatalogRepository } from '../../src/catalog/source'

import type { Metadata } from 'next'
import { CartView } from '../../components/CartView'
import { SiteFooter } from '../../components/SiteFooter'
import { SiteHeader } from '../../components/SiteHeader'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Корзина — VOZDOOH',
  description: 'Демонстрационная корзина VOZDOOH. Оформление заказа откроется после подключения 1С и платёжного провайдера.',
  robots: { index: false, follow: false },
}

export default async function CartPage() {
  const products = await (await getCatalogRepository()).list()
  const demo = catalogSource() === 'demo'
  return (
    <main>
      <SiteHeader />
      <CartView products={products} demo={demo} />
      <SiteFooter />
    </main>
  )
}
