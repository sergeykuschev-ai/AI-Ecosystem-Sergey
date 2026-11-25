import type { CatalogProduct } from './contracts'
import { isPubliclyPurchasable } from './presentation'

const giftPairs = [
  ['CAND-XM180', 'teatro-xmas-candle-180'],
  ['CAPP-XMTFU', 'teatro-xmas-gift-set'],
] as const

/** Input must be the current provider snapshot after withValidImages. */
export function seasonalGifts(products: readonly CatalogProduct[]): CatalogProduct[] {
  return giftPairs.flatMap(([sku, slug]) => {
    const product = products.find(item => item.trade.sku === sku && item.editorial.slug === slug &&
      item.trade.brand === 'TEATRO Fragranze Uniche' && isPubliclyPurchasable(item))
    return product ? [product] : []
  })
}
