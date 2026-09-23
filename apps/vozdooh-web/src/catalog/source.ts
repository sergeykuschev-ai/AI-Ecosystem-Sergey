import { resolve } from 'node:path'
import type { CatalogRepository, EditorialProduct } from './contracts'
import { demoProducts } from './demo'
import { assertLocalMode, readLocalCatalog, readStagedCatalog } from './localStore'
import { createCatalogRepository, mergeCatalog } from './repository'
import { stagedEditorial, stagedTrade } from './stagedEditorial'

export type CatalogSource = 'demo' | 'local-1c' | 'staged-1c' | '1c'

let stagedCache: { path: string; loadedAt: number; products: Awaited<ReturnType<typeof readStagedCatalog>> } | null = null

export function catalogSource(value = process.env.CATALOG_PROVIDER): CatalogSource {
  if (value === undefined || value === 'stub' || value === 'demo') return 'demo'
  if (value === 'local-1c' || value === 'staged-1c' || value === '1c') return value
  throw new Error('INVALID_CATALOG_PROVIDER')
}

/** Server-only composition root. No endpoint/auth assumptions or silent demo fallback. */
export async function getCatalogRepository(
  editorial: Readonly<Record<string, EditorialProduct>> = {},
): Promise<CatalogRepository> {
  const source = catalogSource()
  if (source === 'demo') return createCatalogRepository(demoProducts)
  if (source === '1c') throw new Error('ONEC_LIVE_NOT_CONFIGURED')

  if (source === 'local-1c') assertLocalMode()
  const path = resolve(
    /* turbopackIgnore: true */
    process.env.ONEC_LOCAL_CATALOG_PATH ?? '.local/onec-catalog.json',
  )
  let products
  if (source === 'staged-1c') {
    if (!stagedCache || stagedCache.path !== path || Date.now() - stagedCache.loadedAt > 30_000) {
      stagedCache = { path, loadedAt: Date.now(), products: await readStagedCatalog(path) }
    }
    products = stagedCache.products.filter((product) => (product.stock ?? 0) > 0).map(stagedTrade)
  } else {
    products = await readLocalCatalog(path)
  }
  const content = source === 'staged-1c' ? { ...stagedEditorial(products), ...editorial } : editorial
  return createCatalogRepository(mergeCatalog(products, content))
}
