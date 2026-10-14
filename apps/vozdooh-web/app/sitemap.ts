import type { MetadataRoute } from 'next'
import { getCatalogRepository } from '../src/catalog/source'
import { storefrontProducts, isPubliclyPurchasable } from '../src/catalog/presentation'
import { withValidImages } from '../src/catalog/validImages'
import { availableLandings } from '../src/catalog/landings'
import { availableCollections } from '../src/catalog/collections'

/**
 * Sitemap for the owner-approved public storefront. Computed per request so product,
 * brand, category and collection URLs always reflect the live catalog source.
 */
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://vozdooh27.ru').replace(/\/+$/, '')
  const staticRoutes: MetadataRoute.Sitemap = [
    '/',
    '/catalog',
    '/brands',
    '/categories',
    '/collections',
    '/guides',
    '/guides/kak-vybrat-aromadiffuzor',
    '/guides/aromadiffuzor-v-podarok',
    '/guides/aromat-dlya-gostinoy-i-spalni',
    '/guides/kak-polzovatsya-aromadiffuzorom',
    '/guides/refil-dlya-diffuzora-kak-ispolzovat',
    '/guides/kak-vybrat-aromaticheskuyu-svechu',
    '/finder',
    '/business',
    '/contacts',
    '/khabarovsk',
    '/delivery',
  ].map((path) => ({ url: `${base}${path}`, changeFrequency: 'weekly', priority: path === '/' ? 1 : 0.6 }))

  let dynamicRoutes: MetadataRoute.Sitemap = []
  try {
    const products = storefrontProducts(await withValidImages(await (await getCatalogRepository()).list())).filter(isPubliclyPurchasable)
    const productUrls = products.map((product) => ({ url: `${base}/catalog/${product.editorial.slug}`, changeFrequency: 'weekly' as const, priority: 0.8 }))
    const brandUrls = availableLandings(products, 'brand').map((landing) => ({ url: `${base}/brands/${landing.slug}`, changeFrequency: 'weekly' as const, priority: 0.6 }))
    const categoryUrls = availableLandings(products, 'category').map((landing) => ({ url: `${base}/categories/${landing.slug}`, changeFrequency: 'weekly' as const, priority: 0.6 }))
    const collectionUrls = availableCollections(products).map((collection) => ({ url: `${base}/collections/${collection.slug}`, changeFrequency: 'weekly' as const, priority: 0.6 }))
    dynamicRoutes = [...productUrls, ...brandUrls, ...categoryUrls, ...collectionUrls]
  } catch {
    // Catalog unavailable (e.g. demo mode selected without data): static routes only.
  }

  return [...staticRoutes, ...dynamicRoutes]
}
