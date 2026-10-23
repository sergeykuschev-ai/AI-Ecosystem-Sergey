import type { CatalogProduct } from './contracts'
import { demandRank } from './demandPriority'
import { fragranceFactsFor } from './fragranceFacts'
import { isPubliclyPurchasable } from './presentation'

/** Reviewed TOP-25 alternatives only. Call after withValidImages; this compares
 * fragrance identity, never infers refill compatibility or shared packaging.
 */
export function reviewedFragranceVariants(products: readonly CatalogProduct[], current: CatalogProduct): CatalogProduct[] {
  const facts = fragranceFactsFor(current)
  if (!facts || !current.trade.brand || demandRank(current.trade.sku) === null || !isPubliclyPurchasable(current)) return []
  return products.filter(product =>
    product.trade.sku !== current.trade.sku &&
    product.trade.brand === current.trade.brand &&
    demandRank(product.trade.sku) !== null &&
    isPubliclyPurchasable(product) &&
    fragranceFactsFor(product)?.name === facts.name
  ).sort((a, b) => demandRank(a.trade.sku)! - demandRank(b.trade.sku)!)
}
