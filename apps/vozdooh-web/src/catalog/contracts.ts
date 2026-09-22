export type ProductId = string
export type ProductCategory = 'diffuser'|'candle'|'spray'|'refill'|'car'|'gift'|string

export type CatalogProduct = {
  id: ProductId
  slug: string
  sku: string
  name: string
  brand: string|null
  category: ProductCategory
  volume: string|null
  price: number|null
  stock: number|null
  isActive: boolean
}

export interface CatalogRepository {
  list(): Promise<CatalogProduct[]>
  getBySlug(slug: string): Promise<CatalogProduct | null>
  getBySku(sku: string): Promise<CatalogProduct | null>
}

export interface InventoryRepository {
  getAvailableQuantity(sku: string): Promise<number>
}
