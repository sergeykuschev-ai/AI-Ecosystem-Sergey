import type { CatalogProduct } from '../src/catalog/contracts'
import { seasonalGifts } from '../src/catalog/seasonalGifts'
import { ProductCard } from './ProductCard'

export function SeasonalGifts({ products }: { products: readonly CatalogProduct[] }) {
  const gifts = seasonalGifts(products)
  if (!gifts.length) return null
  return <section className="landingGuide" aria-labelledby="seasonal-gifts-title">
    <h2 id="seasonal-gifts-title">Подарки к зимним праздникам</h2>
    <p>Сезонные позиции TEATRO из текущего наличия. Сравните формат и цену в карточках товаров.</p>
    <div className="catalogGrid">{gifts.map((product, index) => <ProductCard key={product.editorial.slug} product={product} index={index} />)}</div>
  </section>
}
