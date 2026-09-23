import type { Metadata } from 'next'
import { CheckoutForm } from '../../components/CheckoutForm'
import { SiteFooter } from '../../components/SiteFooter'
import { SiteHeader } from '../../components/SiteHeader'

export const metadata: Metadata = {
  title: 'Оформление заказа — VOZDOOH',
  description: 'Демонстрационный сценарий оформления заказа VOZDOOH. Заказы не создаются до подключения 1С и платёжного провайдера.',
  robots: { index: false, follow: false },
}

export default function CheckoutPage() {
  return (
    <main>
      <SiteHeader />
      <section className="pageIntro">
        <span className="eyebrow">Оформление</span>
        <h1>Проверьте выбор</h1>
        <p>Сценарий оформления подготовлен без фиктивной оплаты и без создания заказов: кнопка отправки останется неактивной до подключения 1С и платёжного провайдера.</p>
      </section>
      <CheckoutForm />
      <SiteFooter />
    </main>
  )
}
