import type { CatalogProduct } from './contracts'
import { availableLandings, landingPath } from './landings'
import { availableCollections, collectionPath } from './collections'
import { storefrontProducts, productPresentation } from './presentation'

/** Navigation is derived from the same stocked, pictured subset as the page. */
export function contextualCatalogLinks(products: readonly CatalogProduct[], currentPath: string) {
  const stocked = storefrontProducts(products.filter(product => product.isActive && (product.trade.stock ?? 0) > 0 && product.editorial.slug))
  const sections = [
    ...availableLandings(stocked, 'brand').filter(item => ['culti-milano', 'teatro-fragranze-uniche'].includes(item.slug)).map(item => ({ href: landingPath('brand', item.slug), label: item.name })),
    ...availableLandings(stocked, 'category').filter(item => ['diffusers', 'candles'].includes(item.slug)).map(item => ({ href: landingPath('category', item.slug), label: item.slug === 'diffusers' ? 'Аромадиффузоры' : 'Ароматические свечи' })),
    ...availableCollections(stocked).filter(item => ['home-fragrance', 'gift-diffusers'].includes(item.slug)).map(item => ({ href: collectionPath(item.slug), label: item.slug === 'gift-diffusers' ? 'Диффузоры в подарок' : 'Ароматы для дома' })),
  ].filter(item => item.href !== currentPath)
  const examples = stocked.slice(0, 3).map(product => ({ href: `/catalog/${product.editorial.slug}`, label: [product.trade.brand, productPresentation(product).title, product.trade.volume].filter(Boolean).join(' · ') })).filter(item => item.href !== currentPath)
  return { sections, examples }
}
