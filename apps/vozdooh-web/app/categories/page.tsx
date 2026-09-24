import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteFooter } from '../../components/SiteFooter'
import { SiteHeader } from '../../components/SiteHeader'
import { availableLandings, landingPath } from '../../src/catalog/landings'
import { getCatalogRepository } from '../../src/catalog/source'
import { withValidImages } from '../../src/catalog/validImages'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Категории — VOZDOOH', description: 'Диффузоры, свечи, спреи и другие форматы интерьерных ароматов VOZDOOH.',
  alternates: { canonical: '/categories' }, robots: { index: false, follow: false } }

export default async function DiscoveryPage() {
  const products = await withValidImages(await (await getCatalogRepository()).list())
  const landings = availableLandings(products, 'category')
  return <main className="simplePage discoveryPage">
    <SiteHeader />
    <section className="simpleSection">
      <span className="eyebrow">Категории</span>
      <h1>Ароматы по форматам</h1>
      <p>Диффузоры, свечи, спреи и другие форматы интерьерных ароматов VOZDOOH.</p>
      <nav className="landingLinks" aria-label="Навигация по каталогу"><Link href="/catalog">Все ароматы</Link><Link href="/brands">Бренды</Link></nav>
      {landings.length > 0 ? <div className="brandGrid">
        {landings.map((landing) => <Link className="brandTile" href={landingPath('category', landing.slug)} key={landing.slug}>
          <h2>{landing.name}</h2><p>{landing.description}</p><span>Смотреть коллекцию →</span>
        </Link>)}
      </div> : <p>Коллекция готовится к знакомству.</p>}
    </section>
    <SiteFooter />
  </main>
}
