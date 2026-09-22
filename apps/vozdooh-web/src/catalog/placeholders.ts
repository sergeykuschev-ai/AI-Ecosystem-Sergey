import type { CatalogProduct } from './contracts'

export type CatalogPlaceholder = CatalogProduct & {
  category: 'diffusers' | 'candles' | 'sprays' | 'refills' | 'car' | 'gifts'
  family: 'woody' | 'fresh' | 'citrus' | 'floral' | 'spicy' | 'warm'
}

export const placeholderProducts: CatalogPlaceholder[] = [
  { id: 'demo-01', slug: 'demo-01', sku: 'DEMO-01', name: 'Демонстрационный товар 01', isActive: true, brand: null, volume: null, price: null, stock: null, category: 'diffusers', family: 'woody' },
  { id: 'demo-02', slug: 'demo-02', sku: 'DEMO-02', name: 'Демонстрационный товар 02', isActive: true, brand: null, volume: null, price: null, stock: null, category: 'candles', family: 'fresh' },
  { id: 'demo-03', slug: 'demo-03', sku: 'DEMO-03', name: 'Демонстрационный товар 03', isActive: true, brand: null, volume: null, price: null, stock: null, category: 'sprays', family: 'citrus' },
  { id: 'demo-04', slug: 'demo-04', sku: 'DEMO-04', name: 'Демонстрационный товар 04', isActive: true, brand: null, volume: null, price: null, stock: null, category: 'refills', family: 'warm' },
]

export const categoryLabels = {
  diffusers: 'Диффузоры', candles: 'Свечи', sprays: 'Спреи',
  refills: 'Рефилы', car: 'Для автомобиля', gifts: 'Подарки',
} as const

export const familyLabels = {
  woody: 'Древесные', fresh: 'Свежие', citrus: 'Цитрусовые',
  floral: 'Цветочные', spicy: 'Пряные', warm: 'Тёплые',
} as const
