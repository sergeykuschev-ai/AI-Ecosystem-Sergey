import type { CatalogProduct } from '../catalog/contracts'
import type { Landing } from '../catalog/landings'

export const receivingSummary = 'Доставка в доступные пункты Ozon по России; тариф и сроки подтверждаются до отправки. Бесплатный самовывоз в Хабаровске.'

/** Metadata only: fit complete format names and sentences, never a sliced word. */
export function landingMetadataDescription(landing: Landing, products: readonly CatalogProduct[], kind: 'brand' | 'category'): string {
  const stocked = products.filter(product => (product.trade.stock ?? 0) > 0)
  const formats = kind === 'brand' ? [...new Set(stocked.map(product => product.trade.category))].filter(Boolean) : []
  const receiving = 'Доставка в доступные пункты Ozon по России. Бесплатный самовывоз в Хабаровске.'
  const identity = `${landing.name} в VOZDOOH`
  const availability = stocked.length ? ' В наличии.' : ' Каталог.'
  let description = `${identity}.${availability} ${receiving}`
  for (let count = formats.length; count > 0; count--) {
    const candidate = `${identity}: ${formats.slice(0, count).join(', ')}.${availability} ${receiving}`
    if (candidate.length <= 165) { description = candidate; break }
  }
  if (description.length < 140) {
    const detail = [' Сравните товары, форматы и описания в каталоге VOZDOOH.', ' Сравните товары в каталоге VOZDOOH.', ' Выберите формат в каталоге.', ' Выбор в каталоге.']
      .find(text => (description + text).length >= 140 && (description + text).length <= 165)
    if (detail) description += detail
  }
  // Current landing names fit intact. Fail explicitly if future data exceeds the contract.
  if (description.length > 170) throw new Error('Landing metadata exceeds 170 characters; review the landing name')
  return description
}

/** Brand descriptions name only formats represented by the page's stocked products. */
export function landingSearchDescription(landing: Landing, products: readonly CatalogProduct[], kind: 'brand' | 'category'): string {
  const formats = [...new Set(products.filter(product => (product.trade.stock ?? 0) > 0).map(product => product.trade.category))]
  const introduction = kind === 'brand'
    ? `${landing.name} из наличия VOZDOOH${formats.length ? `: ${formats.join(', ')}` : ''}. Сравните цены, ароматы и объёмы в карточках.`
    : `${landing.name} из наличия VOZDOOH. ${landing.guidance}`
  return `${introduction} ${receivingSummary}`
}
