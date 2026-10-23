import Link from 'next/link'
import type { CatalogProduct } from '../src/catalog/contracts'
import type { PurchaseGuide } from '../src/catalog/purchaseGuides'
import { productPresentation } from '../src/catalog/presentation'

export function ProductPurchaseGuide({ guide, alternatives }: { guide: PurchaseGuide; alternatives: readonly CatalogProduct[] }) {
  return <section className="landingGuide" aria-labelledby="purchase-guide-title">
    <h2 id="purchase-guide-title">Перед покупкой</h2>
    {guide.questions.map(item => <div key={item.question}>
      <h3>{item.question}</h3>
      <p>{item.answer}</p>
    </div>)}
    {alternatives.length > 0 && <>
      <h3>Сравнить другой объём</h3>
      <nav className="landingLinks" aria-label="Другой объём промывочной жидкости">
        {alternatives.map(product => <Link key={product.trade.sku} href={`/catalog/${product.editorial.slug}`}>
          {product.trade.brand} · {productPresentation(product).title} · {product.trade.volume} →
        </Link>)}
      </nav>
    </>}
    <p><Link className="textLink" href={guide.helpHref}>{guide.helpLabel} →</Link></p>
  </section>
}
