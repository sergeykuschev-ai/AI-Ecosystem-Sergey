import Image from 'next/image'
import Link from 'next/link'
import type { CatalogProduct } from '../src/catalog/contracts'
import { familyLabels, labelFor } from '../src/catalog/vocabulary'

export function ProductCard({ product, index = 0, demo = false }: { product: CatalogProduct; index?: number; demo?: boolean }) {
  const image = product.editorial.images[0] ?? null
  return (
    <Link className="productCard" href={`/catalog/${product.editorial.slug}`}>
      <div className={`productCardVisual tone${index % 4}${image ? ' hasImage' : ''}`}>
        <span className="demoTag">{demo ? 'DEMO' : 'PREVIEW 1C'}</span>
        {image ? (
          <Image className="productCardImage" src={image} alt={product.trade.name} fill sizes="(max-width: 760px) 50vw, 25vw" />
        ) : (
          <span className="productCardMark">Фото ожидается</span>
        )}
      </div>
      <div className="productCardMeta">
        <span>{product.trade.brand ?? labelFor(familyLabels, product.editorial.scentFamily)}</span>
        <h3>{product.trade.name}</h3>
        <p>Пока не в продаже</p>
      </div>
    </Link>
  )
}
