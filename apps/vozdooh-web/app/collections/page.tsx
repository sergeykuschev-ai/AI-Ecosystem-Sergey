import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteFooter } from '../../components/SiteFooter'
import { SiteHeader } from '../../components/SiteHeader'

export const metadata: Metadata = {
  title: 'Коллекции — VOZDOOH',
  description: 'Редакционные коллекции VOZDOOH. Подборки готовятся; доступные товары можно посмотреть в каталоге.',
  robots: { index: false, follow: false },
}

export default function CollectionsPage() {
  return (
    <main className="simplePage">
      <SiteHeader />
      <section className="simpleSection">
        <span className="eyebrow">Коллекции</span>
        <h1>Подборки с характером</h1>
        <p>Коллекции — подборки вокруг настроения, сезона или пространства. Пока они готовятся, можно выбрать товары в каталоге по бренду и формату.</p>
        <div className="placeholderPanel">
          <strong>Подборки готовятся</strong>
          <p>Товары, описания и доступные характеристики уже представлены в каталоге.</p>
          <Link className="primary" href="/catalog">Перейти в каталог</Link>
        </div>
      </section>
      <SiteFooter />
    </main>
  )
}
