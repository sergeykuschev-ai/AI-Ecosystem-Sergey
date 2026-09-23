import { demoProducts, type DemoCategory, type DemoFamily, type DemoMood, type DemoRoom, type DemoProduct } from './demo'

/** Pure filter helpers over the demo catalog. Deterministic and URL-driven. */

export type DemoFilters = {
  category: DemoCategory | null
  family: DemoFamily | null
  mood: DemoMood | null
  room: DemoRoom | null
}

export function applyDemoFilters(filters: DemoFilters): DemoProduct[] {
  return demoProducts.filter((p) => {
    if (filters.category && p.trade.category !== filters.category) return false
    if (filters.family && p.editorial.scentFamily !== filters.family) return false
    if (filters.mood && p.editorial.mood !== filters.mood) return false
    if (filters.room && p.editorial.room !== filters.room) return false
    return true
  })
}

export function getDemoProductBySlug(slug: string): DemoProduct | null {
  return demoProducts.find((p) => p.editorial.slug === slug) ?? null
}

/** Editorial recommendations: other demo products from the same scent family. */
export function getDemoRecommendations(slug: string, limit = 3): DemoProduct[] {
  const product = getDemoProductBySlug(slug)
  if (!product) return []
  return demoProducts
    .filter((p) => p.editorial.slug !== slug && p.editorial.scentFamily === product.editorial.scentFamily)
    .slice(0, limit)
}
