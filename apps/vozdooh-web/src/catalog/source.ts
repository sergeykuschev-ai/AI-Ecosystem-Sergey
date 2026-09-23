import { resolve } from 'node:path'
import type { CatalogRepository, EditorialProduct } from './contracts'
import { demoProducts } from './demo'
import { assertLocalMode, readLocalCatalog } from './localStore'
import { createCatalogRepository, mergeCatalog } from './repository'

export type CatalogSource = 'demo' | 'local-1c' | '1c'
export function catalogSource(value = process.env.CATALOG_PROVIDER): CatalogSource {
  if (value === undefined || value === 'stub' || value === 'demo') return 'demo'
  if (value === 'local-1c' || value === '1c') return value
  throw new Error('INVALID_CATALOG_PROVIDER')
}

/** Server-only composition root. No endpoint/auth assumptions or silent demo fallback. */
export async function getCatalogRepository(
  editorial: Readonly<Record<string, EditorialProduct>> = {},
): Promise<CatalogRepository> {
  const source = catalogSource()
  if (source === 'demo') return createCatalogRepository(demoProducts)
  if (source === '1c') throw new Error('ONEC_LIVE_NOT_CONFIGURED')
  assertLocalMode()
  // Development-only runtime files must never be traced into the deployment bundle.
  const products = await readLocalCatalog(resolve(/* turbopackIgnore: true */ process.env.ONEC_LOCAL_CATALOG_PATH ?? '.local/onec-catalog.json'))
  return createCatalogRepository(mergeCatalog(products, editorial))
}
