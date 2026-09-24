import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ProductCard } from '../../../components/ProductCard'
import { SiteFooter } from '../../../components/SiteFooter'
import { SiteHeader } from '../../../components/SiteHeader'
import { labelFor, familyLabels, moodLabels, roomLabels } from '../../../src/catalog/vocabulary'
import { catalogImage, isDebugCatalog, productPresentation, storefrontProducts } from '../../../src/catalog/presentation'
import { withValidImages } from '../../../src/catalog/validImages'
import type { RawSearchParams } from '../../../src/catalog/filterParams'
import { getRecommendations } from '../../../src/catalog/filters'

import { catalogSource, getCatalogRepository } from '../../../src/catalog/source'

export const dynamic = 'force-dynamic'

type PageParams = { params: Promise<{ slug: string }>; searchParams: Promise<RawSearchParams> }

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug } = await params
  const product = await (await getCatalogRepository()).getBySlug(slug)
  if (!product) return { title: 'Товар не найден — VOZDOOH', robots: { index: false, follow: false } }
  return {
    title: `${productPresentation(product).title} — VOZDOOH`,
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
  const debug = isDebugCatalog(await searchParams)
  const display = productPresentation(product)
  const recommendations = getRecommendations(storefrontProducts(await withValidImages(await repository.list()), debug || demo), product, demo)
  const heroImage = catalogImage((await withValidImages([product]))[0])

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
          <p className="productSubtitle">{display.subtitle}</p>
          <Link className="productBack" href={debug ? "/catalog?debugCatalog=1" : "/catalog"}>← Каталог</Link>
          <div className="productChips">
            {product.editorial.scentFamily && <span>Характер: {labelFor(familyLabels, product.editorial.scentFamily)}</span>}
            {product.editorial.mood && <span>Настроение: {labelFor(moodLabels, product.editorial.mood)}</span>}
            {product.editorial.room && <span>Помещение: {labelFor(roomLabels, product.editorial.room)}</span>}
          </div>
          <p className="productDesc">{product.editorial.description}</p>
          <details className="productFacts">
            <summary>Подробности и характеристики</summary>
            <dl className="productMetaList">
              <div><dt>Бренд</dt><dd>{product.trade.brand ?? (demo ? 'Появится после импорта из 1С' : 'Не указано')}</dd></div>
              <div><dt>Объём</dt><dd>{product.trade.volume ?? (demo ? 'Появится после импорта из 1С' : 'Не указано')}</dd></div>
              <div><dt>Наименование</dt><dd>{product.trade.name}</dd></div>
              <div><dt>Артикул</dt><dd>{product.trade.sku}</dd></div>
              {product.trade.barcode && <div><dt>Штрихкод</dt><dd>{product.trade.barcode}</dd></div>}
              {debug && <div><dt>Остаток 1С</dt><dd>{product.trade.stock ?? 'Не указан'}</dd></div>}
              {Object.entries(product.trade.characteristics).map(([name, value]) => (
                <div key={name}><dt>{name}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          </details>
          {debug && <p className="productDiagnostic">PREVIEW 1C · Цены не публикуются. Оформление заказа недоступно.</p>}
        </div>
      </div>
      {recommendations.length > 0 && (
        <section className="recommendations">
          <span className="eyebrow">Рекомендации</span>
          <h2>Похожий характер аромата</h2>
          <div className="products">
            {recommendations.map((item, index) => (
              <ProductCard product={item} index={index} demo={demo} debug={debug} key={item.id} />
            ))}
          </div>
          <p className="backToCatalog"><Link className="textLink" href="/catalog">← Вернуться в каталог</Link></p>
        </section>
      )}
      <SiteFooter />
    </main>
  )
}
