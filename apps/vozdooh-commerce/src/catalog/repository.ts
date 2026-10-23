import type { CatalogProduct, CatalogRepository, EditorialProduct, InventoryRepository, TradeProduct } from './contracts'

export function emptyEditorial(sku: string): EditorialProduct {
  return { slug: `sku-${Buffer.from(sku).toString('hex')}`, description: null, images: [], scentFamily: null, mood: null, room: null, recommendations: [] }
}

/** Editorial records are supplied separately, keyed by exact, case-sensitive SKU. */
export function mergeCatalog(trades: readonly TradeProduct[], editorial: Readonly<Record<string, EditorialProduct>> = {}): CatalogProduct[] {
  const slugs = new Set<string>()
  return trades.map((trade) => {
    const content = Object.hasOwn(editorial, trade.sku) ? editorial[trade.sku] : emptyEditorial(trade.sku)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(content.slug) || slugs.has(content.slug)) throw new Error('INVALID_EDITORIAL_SLUG')
    slugs.add(content.slug)
    return { id: trade.sku, isActive: true, trade: structuredClone(trade), editorial: structuredClone(content) }
  })
}

/** Read-only snapshot adapter; returns copies so consumers cannot mutate catalog state. */
export function createCatalogRepository(products: readonly CatalogProduct[]): CatalogRepository & InventoryRepository {
  const snapshot = structuredClone(products.filter((product) => product.isActive))
  return {
    async list() { return structuredClone(snapshot) },
    async getBySku(sku) { return structuredClone(snapshot.find((product) => product.trade.sku === sku) ?? null) },
    async getBySlug(slug) { return structuredClone(snapshot.find((product) => product.editorial.slug === slug) ?? null) },
    async getAvailableQuantity(sku) { return snapshot.find((product) => product.trade.sku === sku)?.trade.stock ?? null },
  }
}
