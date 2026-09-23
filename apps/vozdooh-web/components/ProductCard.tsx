import Link from 'next/link'
import type { CatalogProduct } from '../src/catalog/contracts'
import { familyLabels, labelFor } from '../src/catalog/vocabulary'

export function ProductCard({ product, index = 0, demo = false }: { product: CatalogProduct; index?: number; demo?: boolean }) {
  return (
    <Link className="productCard" href={`/catalog/${product.editorial.slug}`}>
      <div className={`productCardVisual tone${index % 4}`}>
        <span className="demoTag">{demo ? 'DEMO' : 'PREVIEW 1C'}</span>
        <span className="productCardMark">Фото ожидается</span>
      </div>
      <div className="productCardMeta">
        <span>{labelFor(familyLabels, product.editorial.scentFamily)}</span>
        <h3>{product.trade.name}</h3>
        <p>Пока не в продаже</p>
      </div>
    </Link>
  )
}
