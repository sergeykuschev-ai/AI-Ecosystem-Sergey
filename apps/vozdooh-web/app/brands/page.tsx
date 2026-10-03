import type { Metadata } from 'next'
import { publicRobots } from '../../src/seo/indexing'
import Link from 'next/link'
import { SiteFooter } from '../../components/SiteFooter'
import { SiteHeader } from '../../components/SiteHeader'
import { availableLandings, landingPath } from '../../src/catalog/landings'
import { getCatalogRepository } from '../../src/catalog/source'
import { withValidImages } from '../../src/catalog/validImages'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Бренды ароматов для дома — VOZDOOH', description: 'Знакомство с брендами интерьерной парфюмерии в коллекции VOZDOOH.',
  alternates: { canonical: '/brands' }, robots: publicRobots() }

export default async function DiscoveryPage() {
  const products = await withValidImages(await (await getCatalogRepository()).list())
  const landings = availableLandings(products, 'brand')
  return <main className="simplePage discoveryPage">
    <SiteHeader />
    <section className="simpleSection">
      <span className="eyebrow">Бренды</span>
      <h1>Бренды ароматов для дома</h1>
      <p>Знакомство с брендами интерьерной парфюмерии в коллекции VOZDOOH.</p>
      <nav className="landingLinks" aria-label="Навигация по каталогу"><Link href="/catalog">Все ароматы</Link><Link href="/categories">Категории</Link></nav>
      {landings.length > 0 ? <div className="brandGrid">
        {landings.map((landing) => <Link className="brandTile" href={landingPath('brand', landing.slug)} key={landing.slug}>
          <h2>{landing.name}</h2><p>{landing.description}</p><span>Смотреть коллекцию →</span>
        </Link>)}
      </div> : <p>Коллекция готовится к знакомству.</p>}
    </section>
    <SiteFooter />
  </main>
}
