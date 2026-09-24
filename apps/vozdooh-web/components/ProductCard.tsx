import Image from 'next/image'
import Link from 'next/link'
import type { CatalogProduct } from '../src/catalog/contracts'
import { catalogImage, productPresentation } from '../src/catalog/presentation'

export function ProductCard({ product, index = 0, demo = false, debug = false }: { product: CatalogProduct; index?: number; demo?: boolean; debug?: boolean }) {
  const image = catalogImage(product)
  const display = productPresentation(product)
  return (
    <Link className="productCard" href={`/catalog/${product.editorial.slug}${debug ? "?debugCatalog=1" : ""}`} title={product.trade.name}>
      <div className={`productCardVisual tone${index % 4}${image ? ' hasImage' : ''}`}>
        {(demo || debug) && <span className="demoTag">{demo ? 'DEMO' : 'PREVIEW 1C'}</span>}
        {image ? (
          <Image className="productCardImage" src={image} alt={product.trade.name} fill sizes="(max-width: 760px) 50vw, 25vw" />
        ) : (
          <span className="productCardMark">{demo ? "DEMO" : debug ? "Фото ожидается" : "VOZDOOH"}</span>
        )}
      </div>
      <div className="productCardMeta">
        <span>{product.trade.brand ?? ''}</span>
        <h3>{display.title}</h3>
        {display.russianTitle && <p className="productTranslation">{display.russianTitle}</p>}
        <p>{display.subtitle}</p>
      </div>
    </Link>
  )
}
