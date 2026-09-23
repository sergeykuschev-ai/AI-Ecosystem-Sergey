import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteFooter } from '../../components/SiteFooter'
import { SiteHeader } from '../../components/SiteHeader'
import { catalogSource, getCatalogRepository } from '../../src/catalog/source'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Бренды — VOZDOOH',
  description: 'Бренды из фактического ассортимента VOZDOOH.',
  robots: { index: false, follow: false },
}

export default async function BrandsPage() {
  const products = await (await getCatalogRepository()).list()
  const demo = catalogSource() === 'demo'
  const counts = new Map<string, number>()
  if (!demo) for (const product of products) {
    if (!product.trade.brand) continue
    counts.set(product.trade.brand, (counts.get(product.trade.brand) ?? 0) + 1)
  }
  const brands = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b, 'ru'))

  return (
    <main className="simplePage">
      <SiteHeader />
      <section className="simpleSection">
        <span className="eyebrow">Бренды</span>
        <h1>Коллекция брендов</h1>
        <p>{demo ? 'Бренды появятся после подключения реального ассортимента.' : `В закрытом предпросмотре подтверждено ${brands.length} брендов из фактического остатка 1С. Неподтверждённые позиции не получают бренд автоматически.`}</p>
        {brands.length > 0 ? (
          <div className="brandGrid">
            {brands.map(([brand, count], index) => (
              <Link className="brandTile" href={`/catalog?brand=${encodeURIComponent(brand)}`} key={brand}>
                <small>{String(index + 1).padStart(2, '0')} / {count} поз.</small>
                <h2>{brand}</h2>
                <span>Смотреть товары →</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="placeholderPanel">
            <strong>REAL BRANDS FROM 1C</strong>
            <p>Список формируется только из подтверждённых данных каталога.</p>
            <Link className="primary" href="/catalog">Смотреть каталог</Link>
          </div>
        )}
      </section>
      <SiteFooter />
    </main>
  )
}
