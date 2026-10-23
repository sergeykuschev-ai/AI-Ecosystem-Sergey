import type { CatalogProduct } from '../catalog/contracts'
import type { RawSearchParams } from '../catalog/filterParams'
import { parseCatalogFilters } from '../catalog/filterParams'
import { availableLandings, landingPath } from '../catalog/landings'
import { storefrontProducts, isDebugCatalog } from '../catalog/presentation'
import { catalogSearchQuery } from '../catalog/search'
import { publicRobots } from './indexing'

const filterKeys = ['brand', 'category', 'family', 'mood', 'room'] as const
const first = (value: RawSearchParams[string]) => (Array.isArray(value) ? value[0] : value) ?? ''

/** There is one complete HTML listing, not a paginated series. */
export function catalogPaginationPolicy(pages: readonly string[]): 'pass' | 'normalize' | 'missing' {
  if (!pages.length) return 'pass'
  return pages.length === 1 && pages[0] === '1' ? 'normalize' : 'missing'
}

/** Facets are browsing utilities; canonical targets must represent their actual subset. */
export function catalogIndexPolicy(params: RawSearchParams, products: readonly CatalogProduct[]) {
  if (isDebugCatalog(params)) return { canonical: '/catalog', robots: { index: false, follow: true }, invalidFilters: false }
  const stocked = storefrontProducts(products.filter(product => (product.trade.stock ?? 0) > 0))
  const brands = Object.fromEntries(stocked.filter(product => product.trade.brand).map(product => [product.trade.brand!, product.trade.brand!]))
  const categories = Object.fromEntries(stocked.map(product => [product.trade.category, product.trade.category]))
  const filters = parseCatalogFilters(params, categories, brands)
  const selected = filterKeys.filter(key => first(params[key]) !== '')
  const invalidFilters = selected.some(key => !filters[key])
  const query = new URLSearchParams()
  for (const key of selected) query.set(key, first(params[key]))
  if (params.q !== undefined) query.set('q', catalogSearchQuery(params.q))
  const canonical = query.size ? `/catalog?${query}` : '/catalog'
  if (params.q !== undefined || invalidFilters) return { canonical, robots: { index: false, follow: true }, invalidFilters }
  if (selected.length === 1 && selected[0] === 'brand') {
    const brand = availableLandings(stocked, 'brand').find(landing => landing.name === filters.brand)
    if (brand) return { canonical: landingPath('brand', brand.slug), robots: publicRobots(), invalidFilters: false }
  }
  if (selected.length) return { canonical, robots: { index: false, follow: true }, invalidFilters: false }
  // Unknown/tracking params do not change the listing. Preserve attribution in the
  // browser URL while canonicalizing the duplicate to the public catalog.
  return { canonical: '/catalog', robots: publicRobots(), invalidFilters: false }
}
