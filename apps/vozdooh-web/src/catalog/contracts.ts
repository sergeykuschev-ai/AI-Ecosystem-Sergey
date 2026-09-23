/**
 * Catalog domain contracts.
 *
 * Boundary rule (pre-1C state):
 * - Trade fields come ONLY from the future 1C exchange: SKU, name, brand,
 *   category, volume, price, stock, barcode and the available characteristics
 *   that 1C actually provides.
 * - Editorial fields (descriptions, images, scent family, mood, room,
 *   recommendations) are content and NEVER arrive from 1C. They are managed
 *   by the VOZDOOH content process.
 *
 * Until the 1C adapter exists, the demo catalog fills trade fields with
 * explicit nulls and marks every product as a DEMO placeholder.
 */

export type ProductId = string

/** Fields owned by the 1C trade system. All nullable until the first sync. */
export type TradeProduct = {
  sku: string
  name: string
  brand: string | null
  category: string
  volume: string | null
  /** Price in RUB. null until confirmed by the 1C exchange. Never invented. */
  price: number | null
  /** Available stock units. null until confirmed by the 1C exchange. */
  stock: number | null
  barcode: string | null
  /**
   * Characteristics that are actually available in 1C for this product
   * (e.g. colour, material). Empty record when 1C provides none.
   */
  characteristics: Record<string, string>
}

/** Fields owned by the editorial/content process. Never sourced from 1C. */
export type EditorialProduct = {
  slug: string
  description: string | null
  images: string[]
  scentFamily: string | null
  mood: string | null
  room: string | null
  /** Slugs of editorially related products. */
  recommendations: string[]
}

export type CatalogProduct = {
  id: ProductId
  isActive: boolean
  trade: TradeProduct
  editorial: EditorialProduct
}

export interface CatalogRepository {
  list(): Promise<CatalogProduct[]>
  getBySlug(slug: string): Promise<CatalogProduct | null>
  getBySku(sku: string): Promise<CatalogProduct | null>
}

export interface InventoryRepository {
  /** null when the stock source is not connected yet. */
  getAvailableQuantity(sku: string): Promise<number | null>
}
