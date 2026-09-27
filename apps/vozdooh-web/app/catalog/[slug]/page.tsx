import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AddToCartButton } from '../../../components/AddToCartButton'
import { ProductCard } from '../../../components/ProductCard'
import { SiteFooter } from '../../../components/SiteFooter'
import { SiteHeader } from '../../../components/SiteHeader'
import { labelFor, familyLabels, moodLabels, roomLabels } from '../../../src/catalog/vocabulary'
import { catalogImage, isDebugCatalog, productPresentation, storefrontProducts, sameBrandProducts } from '../../../src/catalog/presentation'
import { isExternallyConfirmedPopular, POPULARITY_NOTE } from '../../../src/catalog/demandPriority'
import { withValidImages } from '../../../src/catalog/validImages'
import { catalogHref, parseCatalogFilters, type RawSearchParams } from '../../../src/catalog/filterParams'
import { brandLandings, categoryLandings, landingPath } from '../../../src/catalog/landings'
import { getRecommendations } from '../../../src/catalog/filters'

import { catalogSource, getCatalogRepository } from '../../../src/catalog/source'

export const dynamic = 'force-dynamic'

type PageParams = { params: Promise<{ slug: string }>; searchParams: Promise<RawSearchParams> }

const rub = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0, maximumFractionDigits: 2 })

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug } = await params
  const product = await (await getCatalogRepository()).getBySlug(slug)
  if (!product) return { title: 'Товар не найден — VOZDOOH', robots: { index: false, follow: false } }
  return {
    title: `${productPresentation(product).title} · ${product.trade.brand ?? 'VOZDOOH'} · ${productPresentation(product).subtitle}`,
    alternates: { canonical: `/catalog/${product.editorial.slug}` },
    description: catalogSource() === 'demo'
      ? 'Демонстрационная карточка товара VOZDOOH. Цена, наличие и характеристики появятся после синхронизации с 1С.'
      : product.editorial.description ?? 'Интерьерная парфюмерия VOZDOOH.',
    robots: { index: false, follow: false },
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
  const heroImage = catalogImage((await withValidImages([product]))[0])
  if (!heroImage && !demo && !debug) notFound()

  return (
    <main className="productPage">
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
          <div className="productChips">
            {product.editorial.scentFamily && <span>Характер: {labelFor(familyLabels, product.editorial.scentFamily)}</span>}
            {product.editorial.mood && <span>Настроение: {labelFor(moodLabels, product.editorial.mood)}</span>}
            {product.editorial.room && <span>Помещение: {labelFor(roomLabels, product.editorial.room)}</span>}
          </div>
          {product.editorial.description && <p className="productDesc">{product.editorial.description}</p>}
          {(brandLanding || categoryLanding) && <nav className="landingLinks" aria-label="Коллекция товара">
            {brandLanding && <Link href={landingPath('brand', brandLanding.slug)}>{brandLanding.name}</Link>}
            {categoryLanding && <Link href={landingPath('category', categoryLanding.slug)}>{categoryLanding.name}</Link>}
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
