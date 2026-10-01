import Link from 'next/link'
import type { CatalogProduct } from '../src/catalog/contracts'
import { availableLandings, landingPath, type Landing } from '../src/catalog/landings'
import { ProductCard } from './ProductCard'
import { SiteHeader } from './SiteHeader'
import { SiteFooter } from './SiteFooter'
import { TrackView } from './TrackView'
import { landingStructuredData, serializeStructuredData } from '../src/catalog/structuredData'

export function CatalogLanding({ landing, products, kind }: { landing: Landing; products: CatalogProduct[]; kind: 'brand' | 'category' }) {
  const structuredData = serializeStructuredData(landingStructuredData({ kind, slug: landing.slug, name: landing.name, description: landing.description, products }))
  const relatedKind = kind === 'brand' ? 'category' : 'brand'
  const related = availableLandings(products, relatedKind)
  return <main className="catalogPage landingPage">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
    {kind === 'brand' && <TrackView event="view_brand" payload={{ item_brand: landing.name, slug: landing.slug }} />}
    <SiteHeader />
    <section className="pageIntro">
      <nav className="landingLinks" aria-label="Навигация по каталогу"><Link href="/catalog">Каталог</Link><Link href={kind === 'brand' ? '/brands' : '/categories'}>{kind === 'brand' ? 'Бренды' : 'Категории'}</Link></nav>
      <h1>{landing.name}</h1>
      <p>{landing.description}</p>
    </section>
    {kind === 'brand' && landing.story && (
      <section className="brandStory" aria-labelledby="brandStoryTitle">
        <div className="brandStoryLead">
          <span className="eyebrow">{landing.story.eyebrow}</span>
          <h2 id="brandStoryTitle">{landing.story.title}</h2>
        </div>
        <div className="brandStoryBody">
          {landing.story.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
        <dl className="brandStoryFacts">
          {landing.story.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
        </dl>
        <div className="brandStoryCraft">
          <span>ДНК бренда</span>
          <h3>{landing.story.craft.title}</h3>
          <p>{landing.story.craft.text}</p>
        </div>
      </section>
    )}
    <section className="landingGuide" aria-labelledby="landingGuideTitle">
      <h2 id="landingGuideTitle">{kind === 'brand' ? 'В коллекции VOZDOOH' : 'Выбор формата'}</h2>
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
