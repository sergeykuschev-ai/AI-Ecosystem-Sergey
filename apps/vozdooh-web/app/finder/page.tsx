import type { Metadata } from 'next'
import { ScentFinder } from '../../components/ScentFinder'
import { SiteFooter } from '../../components/SiteFooter'
import { SiteHeader } from '../../components/SiteHeader'

export const metadata: Metadata = {
  title: 'Подобрать аромат — VOZDOOH',
  description: 'Помощник выбора аромата для дома. Демонстрационный сценарий без выдуманных товарных характеристик.',
  robots: { index: false, follow: false },
}

export default function FinderPage() {
  return (
    <main className="finderPage">
      <SiteHeader />
      <section className="finderIntro">
        <span className="eyebrow light">Подобрать аромат</span>
        <h1>Начнём с ощущения</h1>
        <p>Не обязательно знать ноты и парфюмерные термины. Выберите характер, настроение, помещение и формат — сценарий сузит выбор. Сейчас он работает на демонстрационных позициях; после импорта будет фильтровать только реальный каталог.</p>
      </section>
      <ScentFinder />
      <SiteFooter />
    </main>
  )
}
