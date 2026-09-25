import { catalogSource, getCatalogRepository } from '../../src/catalog/source'

import type { Metadata } from 'next'
import { CartView } from '../../components/CartView'
import { SiteFooter } from '../../components/SiteFooter'
import { SiteHeader } from '../../components/SiteHeader'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Корзина — VOZDOOH',
  description: 'Корзина VOZDOOH. Проверьте выбранные товары перед отправкой заявки.',
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
