import type { CatalogProduct } from './contracts'
import { storefrontProducts } from './presentation'

export type CollectionRule =
  | { field: 'family'; values: readonly string[] }
  | { field: 'mood'; values: readonly string[] }
  | { field: 'room'; values: readonly string[] }

export type EditorialCollection = {
  slug: string
  eyebrow: string
  name: string
  description: string
  note: string
  rule: CollectionRule
  excludeCategories?: readonly string[]
}

export const editorialCollections: readonly EditorialCollection[] = [
  {
    slug: 'warm-interior',
    eyebrow: 'Характер аромата',
    name: 'Тёплый интерьер',
    description: 'Тёплые композиции из текущей витрины VOZDOOH.',
    note: 'В подборку входят только товары, для которых тёплый характер уже подтверждён в редакционных данных.',
    rule: { field: 'family', values: ['warm'] },
    excludeCategories: ['Для автомобиля', 'Ароматизация помещений'],
  },
  {
    slug: 'fresh-air',
    eyebrow: 'Характер аромата',
    name: 'Свежий воздух',
    description: 'Свежие композиции из актуального ассортимента.',
    note: 'Подборка строится по подтверждённому свежему направлению аромата.',
    rule: { field: 'family', values: ['fresh'] },
    excludeCategories: ['Для автомобиля', 'Ароматизация помещений'],
  },
  {
    slug: 'woods-and-spices',
    eyebrow: 'Характер аромата',
    name: 'Древесные и пряные',
    description: 'Древесные и пряные композиции в одной подборке.',
    note: 'Здесь объединены только товары с подтверждённым древесным или пряным направлением.',
    rule: { field: 'family', values: ['woody', 'spicy'] },
    excludeCategories: ['Для автомобиля', 'Ароматизация помещений'],
  },
  {
    slug: 'floral',
    eyebrow: 'Характер аромата',
    name: 'Цветочный характер',
    description: 'Цветочные композиции из текущей коллекции VOZDOOH.',
    note: 'Состав подборки определяется подтверждённым цветочным направлением аромата.',
    rule: { field: 'family', values: ['floral'] },
    excludeCategories: ['Для автомобиля', 'Ароматизация помещений'],
  },
  {
    slug: 'living-room',
    eyebrow: 'По пространству',
    name: 'Для гостиной',
    description: 'Ароматы, отмеченные для пространства гостиной.',
    note: 'В подборке только товары, для которых гостиная уже указана как редакционное пространство.',
    rule: { field: 'room', values: ['living'] },
    excludeCategories: ['Ароматизация помещений'],
  },
  {
    slug: 'bedroom',
    eyebrow: 'По пространству',
    name: 'Для спальни',
    description: 'Ароматы, отмеченные для пространства спальни.',
    note: 'Подборка не переносит назначение между товарами: здесь только позиции с подтверждённой отметкой спальни.',
    rule: { field: 'room', values: ['bedroom'] },
    excludeCategories: ['Ароматизация помещений'],
  },
  {
    slug: 'focused',
    eyebrow: 'По настроению',
    name: 'Собранность',
    description: 'Композиции с подтверждённым настроением «Собранность».',
    note: 'Подборка строится по уже проверенной редакционной характеристике настроения.',
    rule: { field: 'mood', values: ['focused'] },
    excludeCategories: ['Для автомобиля', 'Ароматизация помещений'],
  },
]

function collectionValue(product: CatalogProduct, field: CollectionRule['field']): string | null {
  if (field === 'family') return product.editorial.scentFamily
  return product.editorial[field]
}

export function collectionProducts(products: readonly CatalogProduct[], collection: EditorialCollection): CatalogProduct[] {
  return storefrontProducts(products.filter((product) =>
    (product.trade.stock ?? 0) > 0 &&
    !collection.excludeCategories?.includes(product.trade.category) &&
    collection.rule.values.includes(collectionValue(product, collection.rule.field) ?? '')
  ))
}

export function availableCollections(products: readonly CatalogProduct[]) {
  return editorialCollections
    .map((collection) => ({ ...collection, products: collectionProducts(products, collection) }))
    .filter((collection) => collection.products.length > 0)
}

export function collectionPath(slug: string): string {
  return `/collections/${slug}`
}


export function collectionsForProduct(product: CatalogProduct): EditorialCollection[] {
  if ((product.trade.stock ?? 0) <= 0 || product.editorial.images.length === 0) return []
  return editorialCollections.filter((collection) =>
    !collection.excludeCategories?.includes(product.trade.category) &&
    collection.rule.values.includes(collectionValue(product, collection.rule.field) ?? '')
  )
}
