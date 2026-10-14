import type { CatalogProduct } from '../catalog/contracts'
import type { Landing } from '../catalog/landings'

export const receivingSummary = 'Доставка в доступные пункты Ozon по России; тариф и сроки подтверждаются до отправки. Бесплатный самовывоз в Хабаровске.'

/** Brand descriptions name only formats represented by the page's stocked products. */
export function landingSearchDescription(landing: Landing, products: readonly CatalogProduct[], kind: 'brand' | 'category'): string {
  const formats = [...new Set(products.filter(product => (product.trade.stock ?? 0) > 0).map(product => product.trade.category))]
  const introduction = kind === 'brand'
    ? `${landing.name} из наличия VOZDOOH${formats.length ? `: ${formats.join(', ')}` : ''}. Сравните цены, ароматы и объёмы в карточках.`
    : `${landing.name} из наличия VOZDOOH. ${landing.guidance}`
  return `${introduction} ${receivingSummary}`
}
