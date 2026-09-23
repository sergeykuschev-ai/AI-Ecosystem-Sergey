import Link from 'next/link'
import { familyLabels, type DemoProduct } from '../src/catalog/demo'

export function ProductCard({ product, index = 0 }: { product: DemoProduct; index?: number }) {
  return (
    <Link className="productCard" href={`/catalog/${product.editorial.slug}`}>
      <div className={`productCardVisual tone${index % 4}`}>
        <span className="demoTag">DEMO</span>
        <span className="productCardMark">Фото ожидается</span>
      </div>
      <div className="productCardMeta">
        <span>{familyLabels[product.editorial.scentFamily]}</span>
        <h3>{product.trade.name}</h3>
        <p>Пока не в продаже</p>
      </div>
    </Link>
  )
}
