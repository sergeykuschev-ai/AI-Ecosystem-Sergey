import { ContextualCatalogLinks } from './ContextualCatalogLinks'
import Link from 'next/link'
import type { CatalogProduct } from '../src/catalog/contracts'
import { availableLandings, landingPath, type Landing } from '../src/catalog/landings'
import { ProductCard } from './ProductCard'
import { SiteHeader } from './SiteHeader'
import { SiteFooter } from './SiteFooter'
import { TrackView } from './TrackView'
import { landingStructuredData, serializeStructuredData } from '../src/catalog/structuredData'
import { productPresentation } from '../src/catalog/presentation'

export function CatalogLanding({ landing, products, kind, heading }: { landing: Landing; products: CatalogProduct[]; kind: 'brand' | 'category'; heading?: string }) {
  const structuredData = serializeStructuredData(landingStructuredData({ kind, slug: landing.slug, name: landing.name, description: landing.description, products }))
  const relatedKind = kind === 'brand' ? 'category' : 'brand'
  const related = availableLandings(products, relatedKind)
  const brandHighlights = kind === 'brand' ? products.slice(0, 4) : []
  return <main className="catalogPage landingPage">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
    {kind === 'brand' && <TrackView event="view_brand" payload={{ item_brand: landing.name, slug: landing.slug }} />}
    <SiteHeader />
    <section className="pageIntro">
      <nav className="landingLinks" aria-label="Навигация по каталогу"><Link href="/catalog">Каталог</Link><Link href={kind === 'brand' ? '/brands' : '/categories'}>{kind === 'brand' ? 'Бренды' : 'Категории'}</Link></nav>
      <h1>{heading ?? landing.name}</h1>
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
    {kind === 'brand' && (
      <section className="landingGuide" aria-label={`Выбрать ${landing.name} из наличия`}>
        <h2>Выбрать {landing.name} из наличия</h2>
        <p>В VOZDOOH показаны позиции {landing.name} из актуального наличия. Можно сравнить аромат, формат и объём, оформить заказ онлайн и оплатить товары через Ozon Pay. Доставка по России доступна в найденные при оформлении пункты Ozon; её стоимость согласовывается отдельно до отправки. Бесплатный самовывоз — Хабаровск, ул. Павла Морозова, 97, после подтверждения готовности.</p>
        {brandHighlights.length > 0 && (
          <nav className="landingLinks" aria-label={`Позиции ${landing.name} из актуального наличия`}>
            {brandHighlights.map((product) => <Link key={product.id} href={`/catalog/${product.editorial.slug}`}>{productPresentation(product).title}</Link>)}
          </nav>
        )}
        <nav className="landingLinks" aria-label="Условия заказа">
          <Link href="/delivery">Доставка и самовывоз</Link>
          <Link href="/khabarovsk">Самовывоз в Хабаровске</Link>
          <Link href="/payment">Оплата</Link>
        </nav>
      </section>
    )}
    <section className="landingGuide" aria-labelledby="landingGuideTitle">
      <h2 id="landingGuideTitle">{kind === 'brand' ? 'В коллекции VOZDOOH' : 'Выбор формата'}</h2>
      <p>{landing.guidance}</p>
      {related.length > 0 && <nav className="landingLinks" aria-label={kind === 'brand' ? 'Форматы коллекции' : 'Бренды категории'}>
        {related.map((item) => <Link key={item.slug} href={landingPath(relatedKind, item.slug)}>{item.name}</Link>)}
      </nav>}
      <Link className="textLink" href={`/catalog?${new URLSearchParams({ [kind]: landing.name })}`}>Все фильтры →</Link>
    </section>
    {kind === 'category' && (
      <section className="landingGuide" aria-label="Покупка и доставка">
        <h2>Онлайн-заказ и получение</h2>
        <p>Товары из наличия можно заказать онлайн и оплатить через Ozon Pay. Доставка по России — в доступные при оформлении пункты Ozon, тариф подтверждается отдельно до отправки. Самовывоз в Хабаровске бесплатный: ул. Павла Морозова, 97, после подтверждения готовности.</p>
        <nav className="landingLinks" aria-label="Условия заказа">
          <Link href="/delivery">Доставка и самовывоз</Link>
          <Link href="/khabarovsk">Самовывоз в Хабаровске</Link>
          <Link href="/payment">Оплата</Link>
          <Link href="/catalog">Весь каталог</Link>
          {landing.slug === 'diffusers' && <><Link href="/guides/kak-vybrat-aromadiffuzor">Как выбрать диффузор</Link><Link href="/guides/kak-polzovatsya-aromadiffuzorom">Как пользоваться диффузором</Link></>}
          {landing.slug === 'refills' && <Link href="/guides/refil-dlya-diffuzora-kak-ispolzovat">Как использовать рефил</Link>}
          {landing.slug === 'candles' && <Link href="/guides/kak-vybrat-aromaticheskuyu-svechu">Как выбрать ароматическую свечу</Link>}
        </nav>
      </section>
    )}
    <div className="catalogSectionHeading catalogCount"><h2>{kind === 'brand' ? `Ароматы ${landing.name} в наличии` : `${heading ?? landing.name} в наличии`}</h2><span>{products.length} позиций</span></div>
    <section className="catalogGrid">{products.map((product) => <ProductCard key={product.id} product={product} filters={{ brand: kind === 'brand' ? landing.name : null, category: kind === 'category' ? landing.name : null, family: null, mood: null, room: null }} />)}</section>
    {related.length > 0 && <nav className="landingRelated landingLinks" aria-label="Продолжить знакомство">
      {related.map((item) => <Link href={landingPath(relatedKind, item.slug)} key={item.slug}>{item.name} →</Link>)}
    </nav>}
    <ContextualCatalogLinks products={products} currentPath={landingPath(kind, landing.slug)} />
    <SiteFooter />
  </main>
}
