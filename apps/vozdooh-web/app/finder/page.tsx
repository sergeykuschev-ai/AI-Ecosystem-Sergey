import { catalogSource, getCatalogRepository } from '../../src/catalog/source'

import type { Metadata } from 'next'
import { ScentFinder } from '../../components/ScentFinder'
import { SiteFooter } from '../../components/SiteFooter'
import { SiteHeader } from '../../components/SiteHeader'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Подобрать аромат — VOZDOOH',
  description: 'Помощник выбора аромата для дома. Демонстрационный сценарий без выдуманных товарных характеристик.',
  robots: { index: false, follow: false },
}

export default async function FinderPage() {
  const products = await (await getCatalogRepository()).list()
  const demo = catalogSource() === 'demo'
  return (
    <main>
      <SiteHeader />
      <div className="finderPage">
        <section className="finderIntro">
          <span className="eyebrow light">Подобрать аромат</span>
          <h1>Начнём с ощущения</h1>
          <p>{demo ? 'Не обязательно знать ноты и парфюмерные термины. Выберите характер, настроение, помещение и формат — сценарий сузит выбор. Сейчас он работает на демонстрационных позициях; после импорта будет фильтровать только реальный каталог.' : 'Выберите характер, настроение, помещение и формат. Подбор использует только заполненные редакционные характеристики.'}</p>
        </section>
        <ScentFinder products={products} demo={demo} />
      </div>
      <SiteFooter />
    </main>
  )
}
