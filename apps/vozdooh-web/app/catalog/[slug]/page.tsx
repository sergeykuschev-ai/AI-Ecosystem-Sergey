import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AddToCartButton } from '../../../components/AddToCartButton'
import { ProductCard } from '../../../components/ProductCard'
import { SiteFooter } from '../../../components/SiteFooter'
import { SiteHeader } from '../../../components/SiteHeader'
import { categoryLabels, demoProducts, familyLabels, moodLabels, roomLabels } from '../../../src/catalog/demo'
import { getDemoProductBySlug, getDemoRecommendations } from '../../../src/catalog/filters'

export const dynamicParams = false

export function generateStaticParams() {
  return demoProducts.map((product) => ({ slug: product.editorial.slug }))
}

type PageParams = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug } = await params
  const product = getDemoProductBySlug(slug)
  if (!product) return { title: 'Товар не найден — VOZDOOH', robots: { index: false, follow: false } }
  return {
    title: `${product.trade.name} — VOZDOOH`,
    description: 'Демонстрационная карточка товара VOZDOOH. Цена, наличие и характеристики появятся после синхронизации с 1С.',
    robots: { index: false, follow: false },
  }
}

export default async function ProductPage({ params }: PageParams) {
  const { slug } = await params
  const product = getDemoProductBySlug(slug)
  if (!product) notFound()
  const recommendations = getDemoRecommendations(slug)

  return (
    <main>
      <SiteHeader />
      <div className="productLayout">
        <div className="productHeroPlaceholder">
          <span className="demoTag">DEMO</span>
          <span className="productHeroMark">PRODUCT IMAGE · ПОСЛЕ КОНТЕНТ-ИМПОРТА</span>
        </div>
        <div className="productInfo">
          <span className="eyebrow">Категория · {categoryLabels[product.trade.category]}</span>
          <h1>{product.trade.name}</h1>
          <p className="productSku">SKU: {product.trade.sku}</p>
          <div className="productChips">
            <span>Характер: {familyLabels[product.editorial.scentFamily]}</span>
            <span>Настроение: {moodLabels[product.editorial.mood]}</span>
            <span>Помещение: {roomLabels[product.editorial.room]}</span>
          </div>
          <p className="productDesc">{product.editorial.description}</p>
          <dl className="productMetaList">
            <div><dt>Бренд</dt><dd>Появится после импорта из 1С</dd></div>
            <div><dt>Объём</dt><dd>Появится после импорта из 1С</dd></div>
            <div><dt>Цена</dt><dd>Появится после синхронизации с 1С</dd></div>
            <div><dt>Наличие</dt><dd>Появится после синхронизации с 1С</dd></div>
            <div><dt>Штрихкод</dt><dd>Появится после импорта из 1С</dd></div>
          </dl>
          <AddToCartButton sku={product.trade.sku} />
          <p className="resultNote">Корзина работает в демонстрационном режиме: оформление заказа откроется после подключения 1С и платёжного провайдера.</p>
        </div>
      </div>
      {recommendations.length > 0 && (
        <section className="recommendations">
          <span className="eyebrow">Рекомендации</span>
          <h2>Похожий характер аромата</h2>
          <div className="products">
            {recommendations.map((item, index) => (
              <ProductCard product={item} index={index} key={item.id} />
            ))}
          </div>
          <p className="backToCatalog"><Link className="textLink" href="/catalog">← Вернуться в каталог</Link></p>
        </section>
      )}
      <SiteFooter />
    </main>
  )
}
