import type { CatalogProduct } from './contracts'
import type { RawSearchParams } from './filterParams'

/** Literal case-insensitive matching; whitespace is normalized in query and fields. */
function normalize(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

export function catalogSearchQuery(value: RawSearchParams[string]): string {
  return normalize((Array.isArray(value) ? value[0] : value) ?? '')
}

/** Search only the already validated, visible storefront selection supplied by the caller. */
export function applyCatalogSearch(products: readonly CatalogProduct[], query: string): CatalogProduct[] {
  const needle = normalize(query).toLocaleLowerCase('ru')
  return products.filter((product) => !needle || [product.trade.name, product.trade.brand, product.trade.sku]
    .some((value) => value && normalize(value).toLocaleLowerCase('ru').includes(needle)))
}
