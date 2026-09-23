import type { CatalogProduct } from './contracts'

/**
 * Single source of DEMO catalog placeholders.
 *
 * Merged from the previous demo.ts / placeholders.ts duplicates.
 * Every product here is an explicit demonstration placeholder:
 * - trade fields that belong to 1C (brand, price, stock, barcode,
 *   volume, characteristics) are null / empty until the real exchange;
 * - editorial demo values (scent family, mood, room) exist only to exercise
 *   filters and the scent finder mechanics. They are NOT claims about any
 *   real product, price, stock or fragrance.
 */

export type DemoCategory = 'diffusers' | 'candles' | 'sprays' | 'refills' | 'car' | 'gifts'
export type DemoFamily = 'woody' | 'fresh' | 'citrus' | 'floral' | 'spicy' | 'warm'
export type DemoMood = 'calm' | 'airy' | 'cozy' | 'focused'
export type DemoRoom = 'living' | 'bedroom' | 'bathroom' | 'study' | 'hallway'

export type DemoProduct = CatalogProduct & {
  trade: CatalogProduct['trade'] & { category: DemoCategory }
  editorial: CatalogProduct['editorial'] & {
    scentFamily: DemoFamily
    mood: DemoMood
    room: DemoRoom
  }
}

const demoEditorial = {
  description: 'Демонстрационное описание. Редакционный текст, изображения и рекомендации появятся после согласования контента и не приходят из 1С.',
  images: [],
  recommendations: [] as string[],
}

function demoProduct(
  index: number,
  category: DemoCategory,
  scentFamily: DemoFamily,
  mood: DemoMood,
  room: DemoRoom,
): DemoProduct {
  const slug = `demo-${String(index).padStart(2, '0')}`
  return {
    id: slug,
    isActive: true,
    trade: {
      sku: `DEMO-${String(index).padStart(2, '0')}`,
      name: `Демонстрационный товар ${String(index).padStart(2, '0')}`,
      brand: null,
      category,
      volume: null,
      price: null,
      stock: null,
      barcode: null,
      characteristics: {},
    },
    editorial: { ...demoEditorial, slug, scentFamily, mood, room },
  }
}

export const demoProducts: DemoProduct[] = [
  demoProduct(1, 'diffusers', 'woody', 'calm', 'study'),
  demoProduct(2, 'candles', 'warm', 'cozy', 'living'),
  demoProduct(3, 'sprays', 'citrus', 'airy', 'bathroom'),
  demoProduct(4, 'refills', 'fresh', 'airy', 'bedroom'),
  demoProduct(5, 'diffusers', 'floral', 'calm', 'bedroom'),
  demoProduct(6, 'candles', 'spicy', 'cozy', 'living'),
  demoProduct(7, 'car', 'citrus', 'focused', 'hallway'),
  demoProduct(8, 'gifts', 'woody', 'focused', 'study'),
]

export const categoryLabels: Record<DemoCategory, string> = {
  diffusers: 'Диффузоры',
  candles: 'Свечи',
  sprays: 'Спреи',
  refills: 'Рефилы',
  car: 'Для автомобиля',
  gifts: 'Подарки',
}

export const familyLabels: Record<DemoFamily, string> = {
  woody: 'Древесные',
  fresh: 'Свежие',
  citrus: 'Цитрусовые',
  floral: 'Цветочные',
  spicy: 'Пряные',
  warm: 'Тёплые',
}

export const moodLabels: Record<DemoMood, string> = {
  calm: 'Спокойствие',
  airy: 'Лёгкость',
  cozy: 'Уют',
  focused: 'Собранность',
}

export const roomLabels: Record<DemoRoom, string> = {
  living: 'Гостиная',
  bedroom: 'Спальня',
  bathroom: 'Ванная',
  study: 'Кабинет',
  hallway: 'Прихожая',
}
