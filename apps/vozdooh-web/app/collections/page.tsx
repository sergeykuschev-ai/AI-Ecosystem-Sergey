import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteFooter } from '../../components/SiteFooter'
import { SiteHeader } from '../../components/SiteHeader'

export const metadata: Metadata = {
  title: 'Коллекции — VOZDOOH',
  description: 'Редакционные коллекции VOZDOOH. Подборки появятся после согласования контента и не зависят от данных 1С.',
  robots: { index: false, follow: false },
}

export default function CollectionsPage() {
  return (
    <main className="simplePage">
      <SiteHeader />
      <section className="simpleSection">
        <span className="eyebrow">Коллекции</span>
        <h1>Подборки с характером</h1>
        <p>Коллекции — редакционный формат: они собираются вручную вокруг настроения, сезона или пространства и никогда не генерируются из учётной системы. До появления реальных товаров здесь будет только структура.</p>
        <div className="placeholderPanel">
          <strong>EDITORIAL COLLECTIONS</strong>
          <p>Первые подборки появятся вместе с реальным каталогом и согласованным контентом.</p>
          <Link className="primary" href="/catalog">Смотреть структуру каталога</Link>
        </div>
      </section>
      <SiteFooter />
    </main>
  )
}
