import type { CatalogProduct } from './contracts'
import { fragranceFactsFor } from './fragranceFacts'
import { productPresentation } from './presentation'

// Reviewed positive-stock scope and evidence: research/product-seo-2026-10-12.md.
const reviewedBrandsBySku: Record<string, string> = {
  N020291: 'Christian Tortu', N020713: 'Christian Tortu',
  N019873: 'Christian Tortu', N019834: 'Christian Tortu',
  N019836: 'Christian Tortu', N019900: 'Christian Tortu',
  V61028: 'Vellutier', V61036: 'Vellutier', V63017: 'Vellutier',
  V63011: 'Vellutier', V61014: 'Vellutier', V62014: 'Vellutier',
  DANHNIR250DEC: 'DANHERA',
}

/** Search snippet for this reviewed iteration; null preserves other page behavior.
 * Trade format distinguishes candles, diffusers and potpourri refreshers.
 * Scent claims come only from reviewed facts or the concise editorial description.
 */
export function reviewedProductSearchDescription(product: CatalogProduct): string | null {
  if (!reviewedBrandsBySku[product.trade.sku] ||
      reviewedBrandsBySku[product.trade.sku] !== product.trade.brand ||
      (product.trade.stock ?? 0) <= 0) return null
  const display = productPresentation(product)
  const facts = fragranceFactsFor(product)
  const identity = [product.trade.brand, facts?.name ?? display.title, display.subtitle].filter(Boolean).join(' · ')
  const detail = facts?.summary ?? product.editorial.description
  return `${identity}.${detail ? ` ${detail}` : ''} В наличии по данным каталога VOZDOOH. Заказать с доставкой по России.`
}
