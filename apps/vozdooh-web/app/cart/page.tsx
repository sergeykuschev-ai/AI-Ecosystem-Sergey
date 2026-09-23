import type { Metadata } from 'next'
import { CartView } from '../../components/CartView'
import { SiteFooter } from '../../components/SiteFooter'
import { SiteHeader } from '../../components/SiteHeader'

export const metadata: Metadata = {
  title: 'Корзина — VOZDOOH',
  description: 'Демонстрационная корзина VOZDOOH. Оформление заказа откроется после подключения 1С и платёжного провайдера.',
  robots: { index: false, follow: false },
}

export default function CartPage() {
  return (
    <main>
      <SiteHeader />
      <CartView />
      <SiteFooter />
    </main>
  )
}
