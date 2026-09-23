import type { CatalogProduct } from './contracts'

export type CatalogFilters = {
  brand?: string | null
  category: string | null
  family: string | null
  mood: string | null
  room: string | null
}

export function applyCatalogFilters(products: readonly CatalogProduct[], filters: CatalogFilters): CatalogProduct[] {
  return products.filter((p) => {
    if (filters.brand && p.trade.brand !== filters.brand) return false
    if (filters.category && p.trade.category !== filters.category) return false
    if (filters.family && p.editorial.scentFamily !== filters.family) return false
    if (filters.mood && p.editorial.mood !== filters.mood) return false
    if (filters.room && p.editorial.room !== filters.room) return false
    return true
  })
}

export function getRecommendations(products: readonly CatalogProduct[], product: CatalogProduct, demo = false, limit = 3): CatalogProduct[] {
  return products.filter((p) => p.id !== product.id && (
    product.editorial.recommendations.includes(p.editorial.slug) ||
    (demo && product.editorial.scentFamily !== null && p.editorial.scentFamily === product.editorial.scentFamily)
  )).slice(0, limit)
}
