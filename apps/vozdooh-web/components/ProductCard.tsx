import Image from 'next/image'
import Link from 'next/link'
import type { CatalogFilters } from '../src/catalog/filters'
import { catalogHref } from '../src/catalog/filterParams'
import type { CatalogProduct } from '../src/catalog/contracts'
import { isExternallyConfirmedPopular, POPULARITY_NOTE } from '../src/catalog/demandPriority'
import { catalogImage, productPresentation } from '../src/catalog/presentation'

export function ProductCard({ product, index = 0, demo = false, debug = false, filters }: { filters?: CatalogFilters; product: CatalogProduct; index?: number; demo?: boolean; debug?: boolean }) {
  const image = catalogImage(product)
  const display = productPresentation(product)
  const query = filters ? catalogHref(filters, 'brand', filters.brand ?? null, debug).split('?')[1] : debug ? 'debugCatalog=1' : ''
  return (
    <Link className="productCard" href={`/catalog/${product.editorial.slug}${query ? `?${query}` : ""}`} title={product.trade.name}>
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
        {isExternallyConfirmedPopular(product.trade.sku) && <span className="popularityBadge" title={POPULARITY_NOTE}>Популярный аромат</span>}
        <h3>{display.title}</h3>
        {display.russianTitle && <p className="productTranslation">{display.russianTitle}</p>}
        <p>{display.subtitle}</p>
      </div>
    </Link>
  )
}
