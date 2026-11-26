import type { CatalogProduct } from './contracts'
import { availableLandings, landingPath } from './landings'
import { availableCollections, collectionPath, commercialCollections, noteCollections } from './collections'
import { storefrontProducts, productPresentation } from './presentation'

/** Examples use the page subset; commercial destination availability uses the validated full catalog. */
export function contextualCatalogLinks(products: readonly CatalogProduct[], currentPath: string, catalogProducts: readonly CatalogProduct[] = products) {
  const stocked = storefrontProducts(products.filter(product => product.isActive && (product.trade.stock ?? 0) > 0 && product.editorial.slug))
  const onPage = new Set(stocked.map(product => JSON.stringify([product.trade.sku, product.editorial.slug])))
  const sections = [
    ...availableLandings(stocked, 'brand').filter(item => ['culti-milano', 'teatro-fragranze-uniche'].includes(item.slug)).map(item => ({ href: landingPath('brand', item.slug), label: item.name })),
    ...availableLandings(stocked, 'category').filter(item => ['diffusers', 'candles'].includes(item.slug)).map(item => ({ href: landingPath('category', item.slug), label: item.slug === 'diffusers' ? 'Аромадиффузоры' : 'Ароматические свечи' })),
    ...availableCollections(stocked).filter(item => ['home-fragrance', 'gift-diffusers'].includes(item.slug)).map(item => ({ href: collectionPath(item.slug), label: item.slug === 'gift-diffusers' ? 'Диффузоры в подарок' : 'Ароматы для дома' })),
    ...(['/categories/diffusers', '/brands/culti-milano'].includes(currentPath) || currentPath.startsWith('/collections/')
      ? availableCollections(catalogProducts).filter(item => [...commercialCollections, ...noteCollections].some(collection => collection.slug === item.slug) && item.products.some(product => onPage.has(JSON.stringify([product.trade.sku, product.editorial.slug])))).map(item => ({ href: collectionPath(item.slug), label: item.name }))
      : []),
  ].filter(item => item.href !== currentPath)
  const examples = stocked.slice(0, 3).map(product => ({ href: `/catalog/${product.editorial.slug}`, label: [product.trade.brand, productPresentation(product).title, product.trade.volume].filter(Boolean).join(' · ') })).filter(item => item.href !== currentPath)
  return { sections, examples }
}
