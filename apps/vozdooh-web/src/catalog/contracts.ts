export type ProductId = string

export type CatalogProduct = {
  id: ProductId
  slug: string
  sku: string
  name: string
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
