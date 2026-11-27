import type { CatalogProduct } from './contracts'
import type { FragranceFacts } from './fragranceFacts'

// Exact 515 g binding; manufacturer evidence and limits are recorded in
// research/v61036-evidence-2026-11-27.md. Trade data is never modified here.
const sourceName = 'Vellutier / Свеча большая Сибирский сосновый лес 515гр / Siberian Pine Forest'
const facts: FragranceFacts = {
  name: 'Siberian Pine Forest', family: 'древесное', facet: 'травяное',
  notes: ['сосна', 'травы', 'зелёные листья', 'полынь', 'мёд', 'кедр', 'древесные ноты', 'амбра'],
  summary: 'Хвойно-травяное начало с сосной, зелёными листьями и полынью сменяется медовым сердцем. В базе — кедр, древесные ноты и амбра.',
  rooms: [], seasons: [], created: null,
  source: 'официальным описанием Vellutier',
}

export function reviewedSiberianPineForest(product: CatalogProduct) {
  if (product.trade.sku !== 'V61036' || product.editorial.slug !== 'vellutier-siberian-pine-forest-515' ||
      product.trade.brand !== 'Vellutier' || product.trade.category !== 'Свечи' ||
      product.trade.name.trim() !== sourceName || !/^515\s*(?:г|гр|g)$/iu.test(product.trade.volume?.trim() ?? '')) return null
  return {
    description: 'В начале композиции — сосна, травы, зелёные листья и полынь; в сердце — мёд. Завершают аромат кедр, древесные ноты и амбра. Siberian Pine Forest — древесно-травяная свеча Vellutier в стекле, 515 г. Размеры: высота 16 см, длина 11 см, ширина 11 см.',
    metadataDescription: 'Vellutier Siberian Pine Forest, свеча 515 г: сосна, травы и полынь, медовое сердце, кедр и амбра в базе. Хвойно-древесный аромат.',
    facts,
  }
}
