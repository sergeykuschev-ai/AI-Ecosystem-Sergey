import type { Metadata } from 'next'
import { publicRobots } from '../../../src/seo/indexing'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AddToCartButton } from '../../../components/AddToCartButton'
import { ProductCard } from '../../../components/ProductCard'
import { SiteFooter } from '../../../components/SiteFooter'
import { SiteHeader } from '../../../components/SiteHeader'
import { TrackView } from '../../../components/TrackView'
import { labelFor, familyLabels, moodLabels, roomLabels } from '../../../src/catalog/vocabulary'
import { catalogImage, isDebugCatalog, productPresentation, storefrontProducts, sameBrandProducts } from '../../../src/catalog/presentation'
import { isExternallyConfirmedPopular, POPULARITY_NOTE } from '../../../src/catalog/demandPriority'
import { withValidImages } from '../../../src/catalog/validImages'
import { catalogHref, parseCatalogFilters, type RawSearchParams } from '../../../src/catalog/filterParams'
import { brandLandings, categoryLandings, landingPath } from '../../../src/catalog/landings'
import { collectionPath, collectionsForProduct } from '../../../src/catalog/collections'
import { getRecommendations } from '../../../src/catalog/filters'
import { productStructuredData, serializeStructuredData } from '../../../src/catalog/structuredData'

import { catalogSource, getCatalogRepository } from '../../../src/catalog/source'

export const dynamic = 'force-dynamic'

type PageParams = { params: Promise<{ slug: string }>; searchParams: Promise<RawSearchParams> }

const rub = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0, maximumFractionDigits: 2 })

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug } = await params
  const product = await (await getCatalogRepository()).getBySlug(slug)
  if (!product) return { title: 'Товар не найден — VOZDOOH', robots: { index: false, follow: false } }
  const display = productPresentation(product)
  const description = catalogSource() === 'demo'
    ? 'Демонстрационная карточка товара VOZDOOH. Цена, наличие и характеристики появятся после синхронизации с 1С.'
    : product.editorial.description ?? 'Интерьерная парфюмерия VOZDOOH.'
  const image = catalogImage(product)
  const title = `${display.title} · ${product.trade.brand ?? 'VOZDOOH'} · ${display.subtitle}`
  return {
    title,
    alternates: { canonical: `/catalog/${product.editorial.slug}` },
    description,
    openGraph: { title, description, ...(image ? { images: [{ url: image, alt: product.trade.name }] } : {}) },
    robots: publicRobots(),
  }
}

export default async function ProductPage({ params, searchParams }: PageParams) {
  const { slug } = await params
  const repository = await getCatalogRepository()
  const product = await repository.getBySlug(slug)
  if (!product) notFound()
  const demo = catalogSource() === 'demo'
  const query = await searchParams
  const debug = isDebugCatalog(query)
  const allProducts = await withValidImages(await repository.list())
  const categories = Object.fromEntries(allProducts.map((item) => [item.trade.category, item.trade.category]))
  const brands = Object.fromEntries(allProducts.flatMap((item) => item.trade.brand ? [[item.trade.brand, item.trade.brand]] : []))
  const filters = parseCatalogFilters(query, categories, brands)
  const backHref = catalogHref(filters, 'brand', filters.brand ?? null, debug)
  const brandLanding = brandLandings.find((item) => item.name === product.trade.brand)
  const categoryLanding = categoryLandings.find((item) => item.name === product.trade.category)
  const display = productPresentation(product)
  const recommendations = getRecommendations(storefrontProducts(allProducts, debug || demo), product, demo)
  const brandProducts = demo ? [] : sameBrandProducts(allProducts, product)
  const productCollections = demo ? [] : collectionsForProduct(product)
  const hasScentProfile = Boolean(product.editorial.scentFamily || product.editorial.mood || product.editorial.room)
  const heroImage = catalogImage((await withValidImages([product]))[0])
  if (!heroImage && !demo && !debug) notFound()
  const structuredData = !demo && !debug && heroImage
    ? serializeStructuredData(productStructuredData(product, heroImage))
    : null

  return (
    <main className="productPage">
      {!demo && <TrackView event="view_item" payload={{ item_id: product.trade.sku, item_brand: product.trade.brand, item_category: product.trade.category, price: product.trade.price, slug: product.editorial.slug }} />}
      {structuredData && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />}
      <SiteHeader />
      <div className="productLayout">
        <div className={`productHeroPlaceholder${heroImage ? ' hasImage' : ''}`}>
          {(demo || debug) && <span className="demoTag">{demo ? 'DEMO' : 'PREVIEW 1C'}</span>}
          {heroImage ? (
            <Image className="productHeroImage" src={heroImage} alt={product.trade.name} fill sizes="(max-width: 760px) 100vw, 58vw" priority />
          ) : (
            <span className="productHeroMark">{debug ? 'Фото ожидается' : 'VOZDOOH'}</span>
          )}
        </div>
        <div className="productInfo">
          <span className="eyebrow">{product.trade.brand}</span>
          <h1>{display.title}</h1>
          {display.russianTitle && <p className="productTranslation">{display.russianTitle}</p>}
          <p className="productSubtitle">{display.subtitle}</p>
          {isExternallyConfirmedPopular(product.trade.sku) && <p className="popularityNote">{POPULARITY_NOTE}</p>}
          <Link className="productBack" href={backHref}>← Каталог</Link>
          {!demo && <section className="productPurchase" aria-label="Цена и наличие">
            <p className="productPrice">{(product.trade.price ?? 0) > 0
              ? rub.format(product.trade.price!)
              : 'Цена не указана'}</p>
            <p className="stockState">{product.trade.stock === null ? 'Наличие не указано' : product.trade.stock >= 1 ? 'В наличии по данным каталога' : 'Нет в наличии'}</p>
            {catalogSource() === 'staged-1c' && (product.trade.price ?? 0) > 0 && (product.trade.stock ?? 0) >= 1 && <AddToCartButton sku={product.trade.sku} />}
            <p className="notice">Заявка без онлайн-оплаты и резерва. Наличие требует подтверждения.</p>
          </section>}
          {categoryLanding && <nav className="landingLinks productFormatLink" aria-label="Формат товара">
            <Link href={landingPath('category', categoryLanding.slug)}>{categoryLanding.name} →</Link>
          </nav>}
          <details className="productFacts">
            <summary>Подробности и характеристики</summary>
            <dl className="productMetaList">
              <div><dt>Бренд</dt><dd>{product.trade.brand ?? (demo ? 'Появится после импорта из 1С' : 'Не указано')}</dd></div>
              {product.trade.volume && product.trade.category !== 'Аксессуары' && <div><dt>Объём / масса</dt><dd>{product.trade.volume}</dd></div>}
              <div><dt>Наименование</dt><dd>{product.trade.name}</dd></div>
              <div><dt>Артикул</dt><dd>{product.trade.sku}</dd></div>
              {product.trade.barcode && <div><dt>Штрихкод</dt><dd>{product.trade.barcode}</dd></div>}
              {debug && <div><dt>Остаток 1С</dt><dd>{product.trade.stock ?? 'Не указан'}</dd></div>}
              {Object.entries(product.trade.characteristics).map(([name, value]) => (
                <div key={name}><dt>{name}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          </details>
          {debug && <p className="productDiagnostic">PREVIEW 1C · Доступна заявка без оплаты и резерва.</p>}
        </div>
      </div>

      {(product.editorial.description || product.editorial.scentFamily || product.editorial.mood || product.editorial.room || brandLanding?.story) && (
        <section className="productEditorial" aria-label={hasScentProfile ? 'История и характер товара' : 'История и детали товара'}>
          <div className="productComposition">
            <span className="eyebrow">{hasScentProfile ? 'Композиция' : 'О товаре'}</span>
            <h2>{hasScentProfile ? 'Характер аромата' : 'Детали продукта'}</h2>
            {product.editorial.description && <p className="productDesc">{product.editorial.description}</p>}
            <div className="productProfileGrid">
              {product.editorial.scentFamily && <div><small>Характер</small><strong>{labelFor(familyLabels, product.editorial.scentFamily)}</strong></div>}
              {product.editorial.mood && <div><small>Настроение</small><strong>{labelFor(moodLabels, product.editorial.mood)}</strong></div>}
              {product.editorial.room && <div><small>Пространство</small><strong>{labelFor(roomLabels, product.editorial.room)}</strong></div>}
            </div>
            {productCollections.length > 0 && (
              <nav className="productCollectionLinks" aria-label="Подборки с этим товаром">
                <small>В подборках VOZDOOH</small>
                <div>{productCollections.map((collection) => <Link href={collectionPath(collection.slug)} key={collection.slug}>{collection.name} →</Link>)}</div>
              </nav>
            )}
          </div>

          {brandLanding?.story && (
            <aside className="productBrandStory">
              <span className="eyebrow light">История бренда</span>
              <h2>{brandLanding.name}</h2>
              <p>{brandLanding.story.paragraphs[0]}</p>
              <dl>
                {brandLanding.story.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
              </dl>
              <div className="productBrandCraft">
                <small>ДНК бренда</small>
                <strong>{brandLanding.story.craft.title}</strong>
                <p>{brandLanding.story.craft.text}</p>
              </div>
              <Link className="brandStoryLink" href={landingPath('brand', brandLanding.slug)}>История {brandLanding.name} →</Link>
            </aside>
          )}
        </section>
      )}

      {recommendations.length > 0 && (
        <section className="recommendations">
          <span className="eyebrow">Рекомендации</span>
          <h2>Вам также может понравиться</h2>
          <div className="products">
            {recommendations.map((item, index) => (
              <ProductCard product={item} index={index} demo={demo} debug={debug} key={item.id} />
            ))}
          </div>
          <p className="backToCatalog"><Link className="textLink" href="/catalog">← Вернуться в каталог</Link></p>
        </section>
      )}
      {brandProducts.length > 0 && (
        <section className="recommendations" aria-labelledby="same-brand-heading">
          <h2 id="same-brand-heading">Ещё из бренда</h2>
          <div className="products">
            {brandProducts.map((item, index) => <ProductCard product={item} index={index} key={item.id} />)}
          </div>
        </section>
      )}
      <SiteFooter />
    </main>
  )
}
