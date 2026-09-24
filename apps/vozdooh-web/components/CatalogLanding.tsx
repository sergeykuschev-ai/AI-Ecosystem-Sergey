import Link from 'next/link'
import type { CatalogProduct } from '../src/catalog/contracts'
import { availableLandings, landingPath, type Landing } from '../src/catalog/landings'
import { ProductCard } from './ProductCard'
import { SiteHeader } from './SiteHeader'
import { SiteFooter } from './SiteFooter'

export function CatalogLanding({ landing, products, kind }: { landing: Landing; products: CatalogProduct[]; kind: 'brand' | 'category' }) {
  const relatedKind = kind === 'brand' ? 'category' : 'brand'
  const related = availableLandings(products, relatedKind)
  return <main className="catalogPage landingPage">
    <SiteHeader />
    <section className="pageIntro">
      <nav className="landingLinks" aria-label="Навигация по каталогу"><Link href="/catalog">Каталог</Link><Link href={kind === 'brand' ? '/brands' : '/categories'}>{kind === 'brand' ? 'Бренды' : 'Категории'}</Link></nav>
      <h1>{landing.name}</h1>
      <p>{landing.description}</p>
    </section>
    <section className="landingGuide" aria-labelledby="landingGuideTitle">
      <h2 id="landingGuideTitle">{kind === 'brand' ? 'Знакомство с коллекцией' : 'Выбор формата'}</h2>
      <p>{landing.guidance}</p>
      {related.length > 0 && <nav className="landingLinks" aria-label={kind === 'brand' ? 'Форматы коллекции' : 'Бренды категории'}>
        {related.map((item) => <Link key={item.slug} href={`/catalog?${new URLSearchParams({ [kind]: landing.name, [relatedKind]: item.name })}`}>{item.name}</Link>)}
      </nav>}
      <Link className="textLink" href={`/catalog?${new URLSearchParams({ [kind]: landing.name })}`}>Все фильтры →</Link>
    </section>
    <div className="catalogSectionHeading catalogCount"><h2>В коллекции</h2><span>{products.length} позиций</span></div>
    <section className="catalogGrid">{products.map((product) => <ProductCard key={product.id} product={product} filters={{ brand: kind === 'brand' ? landing.name : null, category: kind === 'category' ? landing.name : null, family: null, mood: null, room: null }} />)}</section>
    {related.length > 0 && <nav className="landingRelated landingLinks" aria-label="Продолжить знакомство">
      {related.map((item) => <Link href={landingPath(relatedKind, item.slug)} key={item.slug}>{item.name} →</Link>)}
    </nav>}
    <SiteFooter />
  </main>
}
