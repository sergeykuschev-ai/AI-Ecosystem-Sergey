import { merchProducts, merchandisingSignal, MERCHANDISING_NOTE } from './merchandising'
import type { CatalogProduct } from './contracts'
import { storefrontProducts } from './presentation'

export type CollectionRule =
  | { field: 'demand'; values: readonly string[] }
  | { field: 'family'; values: readonly string[] }
  | { field: 'mood'; values: readonly string[] }
  | { field: 'room'; values: readonly string[] }
  | { field: 'category'; values: readonly string[] }

export type EditorialCollection = {
  slug: string
  eyebrow: string
  name: string
  description: string
  note: string
  guideTitle?: string
  guide?: readonly string[]
  rule: CollectionRule
  excludeCategories?: readonly string[]
}

export const editorialCollections: readonly EditorialCollection[] = [
  { slug: 'popular', eyebrow: 'Выбор из наличия', name: 'Популярные ароматы', description: 'Подтверждённый внешний интерес. Ароматы из актуального наличия VOZDOOH.', note: MERCHANDISING_NOTE, rule: { field: 'demand', values: ['verified'] } },
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
  {
    slug: 'gift-diffusers',
    eyebrow: 'Подарочный выбор',
    name: 'Аромадиффузоры в подарок',
    description: 'Аромадиффузоры в подарок из актуального наличия VOZDOOH с доставкой по России. Выбор по бренду, аромату и объёму, онлайн-заказ и доставка по России.',
    note: 'В подборке только диффузоры, которые сейчас есть в наличии. Комплектацию и упаковку каждого товара смотрите в карточке.',
    guideTitle: 'Как выбрать аромадиффузор в подарок',
    guide: [
      'Если вы не знаете точные предпочтения человека, безопаснее начинать со свежих, древесных или мягких цитрусовых композиций. Для хорошо знакомого получателя можно выбирать более выразительные ванильные, пряные и удовые направления.',
      'Объём влияет на масштаб и длительность использования, а дизайн флакона — на то, насколько органично подарок войдёт в интерьер. В карточках VOZDOOH можно сравнить аромат, объём, бренд и актуальную цену.',
    ],
    rule: { field: 'category', values: ['Диффузоры'] },
  },
  {
    slug: 'home-fragrance',
    eyebrow: 'Для дома',
    name: 'Ароматы для дома',
    description: 'Ароматы для дома из актуального наличия VOZDOOH с доставкой по России: диффузоры, свечи, спреи и подарочные наборы. Онлайн-заказ и доставка по России.',
    note: 'Подборка объединяет форматы для ароматизации дома и не включает автомобильные или профессиональные системы.',
    guideTitle: 'Как выбрать аромат для дома',
    guide: [
      'Для постоянного мягкого фона подойдёт диффузор, для короткого атмосферного ритуала — свеча, а спрей удобен, когда аромат нужен сразу. Если важен подарок, начните с диффузора или готового набора.',
      'Сначала выберите характер композиции и комнату, затем формат и объём. Это быстрее, чем искать аромат только по списку нот, особенно если вы знакомитесь с интерьерной парфюмерией впервые.',
    ],
    rule: { field: 'category', values: ['Диффузоры', 'Свечи', 'Спреи для дома', 'Подарочные наборы'] },
  },
]

function collectionValue(product: CatalogProduct, field: CollectionRule['field']): string | null {
  if (field === 'demand') return merchandisingSignal(product.trade.sku) ? 'verified' : null
  if (field === 'family') return product.editorial.scentFamily
  if (field === 'category') return product.trade.category
  return product.editorial[field]
}

export function collectionProducts(products: readonly CatalogProduct[], collection: EditorialCollection): CatalogProduct[] {
  if (collection.rule.field === 'demand') return merchProducts(storefrontProducts(products), 'popular')
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
