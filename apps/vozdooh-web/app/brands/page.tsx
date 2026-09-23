import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteFooter } from '../../components/SiteFooter'
import { SiteHeader } from '../../components/SiteHeader'

export const metadata: Metadata = {
  title: 'Бренды — VOZDOOH',
  description: 'Бренды VOZDOOH появятся после импорта ассортимента из 1С. Бренды не добавляются вручную без подтверждённых данных.',
  robots: { index: false, follow: false },
}

export default function BrandsPage() {
  return (
    <main className="simplePage">
      <SiteHeader />
      <section className="simpleSection">
        <span className="eyebrow">Бренды</span>
        <h1>Коллекция брендов</h1>
        <p>Список будет сформирован из фактического ассортимента после импорта из 1С. Бренды не добавляются вручную и не выдумываются — здесь появятся только производители, реально представленные в учётной системе.</p>
        <div className="placeholderPanel">
          <strong>REAL BRANDS FROM 1C</strong>
          <p>Названия брендов, логотипы и описания будут показаны после первой синхронизации каталога.</p>
          <Link className="primary" href="/catalog">Смотреть структуру каталога</Link>
        </div>
      </section>
      <SiteFooter />
    </main>
  )
}
