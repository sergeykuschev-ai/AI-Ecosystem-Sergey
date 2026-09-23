import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AddToCartButton } from '../../../components/AddToCartButton'
import { ProductCard } from '../../../components/ProductCard'
import { SiteFooter } from '../../../components/SiteFooter'
import { SiteHeader } from '../../../components/SiteHeader'
import { categoryLabels, labelFor, familyLabels, moodLabels, roomLabels } from '../../../src/catalog/vocabulary'
import { getRecommendations } from '../../../src/catalog/filters'

import { catalogSource, getCatalogRepository } from '../../../src/catalog/source'

export const dynamic = 'force-dynamic'

type PageParams = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug } = await params
  const product = await (await getCatalogRepository()).getBySlug(slug)
  if (!product) return { title: 'Товар не найден — VOZDOOH', robots: { index: false, follow: false } }
  return {
    title: `${product.trade.name} — VOZDOOH`,
    description: catalogSource() === 'demo'
      ? 'Демонстрационная карточка товара VOZDOOH. Цена, наличие и характеристики появятся после синхронизации с 1С.'
      : 'Внутренняя синтетическая тестовая позиция. Не для продажи.',
    robots: { index: false, follow: false },
  }
}

export default async function ProductPage({ params }: PageParams) {
  const { slug } = await params
  const repository = await getCatalogRepository()
  const product = await repository.getBySlug(slug)
  if (!product) notFound()
  const demo = catalogSource() === 'demo'
  const recommendations = getRecommendations(await repository.list(), product, demo)

  return (
    <main>
      <SiteHeader />
      <div className="productLayout">
        <div className="productHeroPlaceholder">
          <span className="demoTag">{demo ? 'DEMO' : 'INTERNAL TEST'}</span>
          <span className="productHeroMark">PRODUCT IMAGE · ПОСЛЕ КОНТЕНТ-ИМПОРТА</span>
        </div>
        <div className="productInfo">
          <span className="eyebrow">Категория · {labelFor(categoryLabels, product.trade.category)}</span>
          <h1>{product.trade.name}</h1>
          <p className="productSku">SKU: {product.trade.sku}</p>
          <div className="productChips">
            <span>Характер: {labelFor(familyLabels, product.editorial.scentFamily)}</span>
            <span>Настроение: {labelFor(moodLabels, product.editorial.mood)}</span>
            <span>Помещение: {labelFor(roomLabels, product.editorial.room)}</span>
          </div>
          <p className="productDesc">{product.editorial.description ?? 'Описание пока не добавлено.'}</p>
          <dl className="productMetaList">
            <div><dt>Бренд</dt><dd>{product.trade.brand ?? (demo ? 'Появится после импорта из 1С' : 'Не указано')}</dd></div>
            <div><dt>Объём</dt><dd>{product.trade.volume ?? (demo ? 'Появится после импорта из 1С' : 'Не указано')}</dd></div>
            <div><dt>Цена</dt><dd>{product.trade.price === null ? (demo ? 'Появится после синхронизации с 1С' : 'Не указано') : `${product.trade.price} ₽`}</dd></div>
            <div><dt>Наличие</dt><dd>{product.trade.stock ?? (demo ? 'Появится после синхронизации с 1С' : 'Не указано')}</dd></div>
            <div><dt>Штрихкод</dt><dd>{product.trade.barcode ?? (demo ? 'Появится после импорта из 1С' : 'Не указано')}</dd></div>
            {Object.entries(product.trade.characteristics).map(([name, value]) => (
              <div key={name}><dt>{name}</dt><dd>{value}</dd></div>
            ))}
          </dl>
          <AddToCartButton sku={product.trade.sku} />
          <p className="resultNote">{demo ? 'Корзина работает в демонстрационном режиме: оформление заказа откроется после подключения 1С и платёжного провайдера.' : 'Внутренняя синтетическая тестовая позиция, не для продажи. Корзина хранится только в браузере; оформление заказа недоступно.'}</p>
        </div>
      </div>
      {recommendations.length > 0 && (
        <section className="recommendations">
          <span className="eyebrow">Рекомендации</span>
          <h2>Похожий характер аромата</h2>
          <div className="products">
            {recommendations.map((item, index) => (
              <ProductCard product={item} index={index} demo={demo} key={item.id} />
            ))}
          </div>
          <p className="backToCatalog"><Link className="textLink" href="/catalog">← Вернуться в каталог</Link></p>
        </section>
      )}
      <SiteFooter />
    </main>
  )
}
