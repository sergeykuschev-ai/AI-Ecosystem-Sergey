import { hasBestsellerEvidence } from '../catalog/merchandising'
import type { CatalogProduct } from '../catalog/contracts'

const TITLE_TARGET = 95
const DESCRIPTION_TARGET = 170

type MetadataDisplay = { title: string; subtitle: string }

/** Keep complete presentation identity, including format and variant; never slice names. */
function metadataIdentity(product: CatalogProduct, display: MetadataDisplay): string {
  return [product.trade.brand, display.title, display.subtitle].filter(Boolean).join(' · ')
}

/** Short existing titles stay stable. Identity takes precedence over the soft limit. */
export function conciseProductMetadataTitle(product: CatalogProduct, title: string, display: MetadataDisplay): string {
  if (title.length <= TITLE_TARGET) return title
  // Preserve the verified product type even when shortening a duplicate-prone title.
  // Otherwise the long Teatro diffuser/refill titles lose the distinction here.
  const typePrefix = title.startsWith('Аромадиффузор ') ? 'Аромадиффузор'
    : title.startsWith('Рефил ') ? 'Рефил' : null
  const identity = `${typePrefix ? `${typePrefix} ` : ''}${metadataIdentity(product, display)}`
  const candidates = [
    `${identity} — купить | VOZDOOH`,
    `${identity} | VOZDOOH`,
  ]
  return candidates.find(candidate => candidate.length <= TITLE_TARGET) ?? candidates[1]
}

/** Summarize long snippets from complete factual units, without clipping editorial prose.
 * The caller supplies reviewed fragrance text; no new scent claims are inferred here.
 */
export function conciseProductMetadataDescription(
  product: CatalogProduct, description: string, display: MetadataDisplay, detail = '',
): string {
  if (description.length <= DESCRIPTION_TARGET) return description
  const identity = `${metadataIdentity(product, display)}.`
  const stock = (product.trade.stock ?? 0) >= 1 ? 'В наличии по данным каталога.' : ''
  const delivery = 'Доставка в доступные пункты Ozon по России.'
  const ending = [stock, delivery].filter(Boolean).join(' ')
  const base = `${identity} ${ending}`
  // Keep the complete supplied detail or omit it; punctuation may contain abbreviations.
  const sentence = /[.!?]$/u.test(detail.trim()) ? detail.trim() : ''
  const withDetail = sentence ? `${identity} ${sentence} ${ending}` : base
  if (sentence && withDetail.length <= DESCRIPTION_TARGET) return withDetail
  const withStore = `${identity} Онлайн-заказ в VOZDOOH. ${ending}`
  return withStore.length <= DESCRIPTION_TARGET ? withStore : base
}

/** Limit the title correction to the reviewed duplicate pair; trade data owns the format. */
export function distinctProductMetadataTitle(product: CatalogProduct, title: string): string {
  if (!['teatro-dolce-vaniglia-500', 'teatro-dolce-vaniglia-refill-500'].includes(product.editorial.slug)) return title
  const format = product.trade.category === 'Диффузоры' ? 'Аромадиффузор'
    : product.trade.category === 'Рефилы' ? 'Рефил' : null
  return format ? `${format} ${title}` : title
}

/** Four reviewed CULTI diffusers: make the commercial product type explicit.
 * Other metadata remains unchanged; trade data still owns identity and format.
 */
export function reviewedCommercialTitle(product: CatalogProduct, fallback: string, display: MetadataDisplay): string {
  if (!hasBestsellerEvidence(product.trade.sku) || product.trade.brand !== 'CULTI MILANO' || product.trade.category !== 'Диффузоры') return fallback
  const identity = [product.trade.brand, display.title, product.trade.volume].filter(Boolean).join(' ')
  return `Диффузор ${identity} — купить | VOZDOOH`
}
