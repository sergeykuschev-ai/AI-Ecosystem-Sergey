import { noteNames, verifiedNotesFor, type VerifiedNote } from './verifiedNotes'
import { merchProducts, merchandisingSignal, MERCHANDISING_NOTE } from './merchandising'
import { demandRank } from './demandPriority'
import type { CatalogProduct } from './contracts'
import { isPubliclyPurchasable, storefrontProducts } from './presentation'

export type CollectionRule =
  | { field: 'researchSelection'; values: readonly string[] }
  | { field: 'demand'; values: readonly string[] }
  | { field: 'family'; values: readonly string[] }
  | { field: 'mood'; values: readonly string[] }
  | { field: 'room'; values: readonly string[] }
  | { field: 'category'; values: readonly string[] }
  | { field: 'note'; values: readonly string[] }
  | { field: 'volume' | 'brandLine'; values: readonly string[] }

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
  {
    slug: 'vozdooh-selection',
    eyebrow: 'Из наличия',
    name: 'Подборка VOZDOOH',
    description: 'Редакционный выбор из наличия VOZDOOH: диффузоры, свечи, спреи, автомобильные саше и рефилы. Сравните форматы и найдите подходящий для себя.',
    note: 'Это редакционные рекомендации, а не рейтинг продаж. Состав подборки меняется вместе с наличием.',
    guideTitle: 'Как выбрать свой формат',
    guide: [
      'Для дома выбирайте среди диффузоров, свечей и спреев. Автомобильное саше предназначено для автомобиля. Рефил — сменный аромат для заправки: перед покупкой проверьте назначение и совместимость в карточке товара.',
      'Сравните бренд, формат и объём в карточках. Ориентируйтесь на актуальное наличие и цену; характеристики и комплектацию проверяйте у выбранного товара.',
      'Доставка — только в доступные при оформлении пункты Ozon; стоимость и сроки зависят от направления и подтверждаются до отправки. Доставка оплачивается отдельно. Бесплатный самовывоз — в Хабаровске, после подтверждения готовности заказа.',
    ],
    rule: { field: 'researchSelection', values: ['researched'] },
  },
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
    description: 'Диффузоры в подарок из наличия VOZDOOH: сравните бренд, аромат, объём и оформление флакона. Комплектация — в карточке; доступные пункты Ozon и бесплатный самовывоз в Хабаровске.',
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
    description: 'Подборка ароматов для дома из наличия VOZDOOH. Сравните подходящие форматы и композиции для своего пространства; онлайн-заказ, доступные пункты Ozon и бесплатный самовывоз в Хабаровске.',
    note: 'Подборка объединяет форматы для ароматизации дома и не включает автомобильные или профессиональные системы.',
    guideTitle: 'Как выбрать аромат для дома',
    guide: [
      'Для постоянного мягкого фона подойдёт диффузор, для короткого атмосферного ритуала — свеча, а спрей удобен, когда аромат нужен сразу. Если важен подарок, начните с диффузора или готового набора.',
      'Сначала выберите характер композиции и комнату, затем формат и объём. Это быстрее, чем искать аромат только по списку нот, особенно если вы знакомитесь с интерьерной парфюмерией впервые.',
    ],
    rule: { field: 'category', values: ['Диффузоры', 'Свечи', 'Спреи для дома', 'Подарочные наборы'] },
  },
]

// Issue #304: curated, bounded commercial destinations. The minimum is our
// merchandising guard, not a search-engine requirement. Do not infer from slugs.
export const commercialCollections: readonly EditorialCollection[] = [
  {
    slug: 'diffusers-250-ml',
    eyebrow: 'По объёму',
    name: 'Аромадиффузоры 250 мл',
    description: 'Выберите аромадиффузор 250 мл из наличия VOZDOOH. Сравните композиции, дизайн флаконов, бренды и цены. Доступные варианты доставки уточняются при заказе.',
    note: 'Только диффузоры с подтверждённым объёмом 250 мл, актуальной ценой и наличием. Рефилы и другие форматы не включены.',
    rule: { field: 'volume', values: ['250'] },
  },
  {
    slug: 'diffusers-500-ml',
    eyebrow: 'По объёму',
    name: 'Аромадиффузоры 500 мл',
    description: 'Диффузоры 500 мл для дома: сравните ароматы и оформление флаконов из ассортимента VOZDOOH. Цена и наличие указаны в карточках.',
    note: 'Объём подтверждён данными товара. Длительность использования зависит от композиции и условий помещения.',
    rule: { field: 'volume', values: ['500'] },
  },
  {
    slug: 'culti-decor',
    eyebrow: 'Коллекция бренда',
    name: 'Диффузоры CULTI MILANO Decor',
    description: 'Диффузоры CULTI MILANO линии Decor в VOZDOOH. Сравните варианты Classic и Limited, если они представлены в наличии, по оформлению, аромату и объёму.',
    note: 'В подборку входят только доступные диффузоры CULTI MILANO с обозначением Decor в исходном названии.',
    rule: { field: 'brandLine', values: ['decor'] },
  },
  {
    slug: 'culti-stile',
    eyebrow: 'Коллекция бренда',
    name: 'Диффузоры CULTI MILANO Stile',
    description: 'Познакомьтесь с доступными диффузорами CULTI MILANO Stile. Сравните композиции, варианты флаконов и объёмы; актуальные цены указаны в карточках.',
    note: 'Подборка строится по исходному названию линии Stile, бренду и формату товара.',
    rule: { field: 'brandLine', values: ['stile'] },
  },
]

export const noteCollections: readonly EditorialCollection[] = Object.entries(noteNames).map(([key, name]) => ({
  slug: `notes-${key}`,
  eyebrow: 'По подтверждённым нотам',
  name: `Ароматы с нотой ${name}`,
  description: `Ароматы с нотой ${name} из наличия VOZDOOH. Сравните форматы и цены; ноты подтверждены источниками для конкретных товаров.`,
  note: 'Включены только товары с проверенной связью SKU, аромата и источника. Ноты описывают композицию, а не перечень ингредиентов.',
  rule: { field: 'note', values: [key] },
}))

const MIN_COMMERCIAL_PRODUCTS = 3

function isCommercialCollection(collection: EditorialCollection): boolean {
  return collection.rule.field === 'note' || collection.rule.field === 'volume' || collection.rule.field === 'brandLine'
}

function collectionValue(product: CatalogProduct, field: CollectionRule['field']): string | null {
  if (field === 'note') return null // Multi-note membership is evaluated explicitly below.
  if (field === 'researchSelection') return demandRank(product.trade.sku) !== null ? 'researched' : null
  if (field === 'demand') return merchandisingSignal(product.trade.sku) ? 'verified' : null
  if (field === 'volume' || field === 'brandLine') {
    if (product.trade.category !== 'Диффузоры') return null
    if (field === 'volume') return product.trade.volume?.trim().match(/^(250|500)\s*(?:мл|ml)$/iu)?.[1] ?? null
    if (product.trade.brand !== 'CULTI MILANO') return null
    const name = product.trade.name.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase()
    return name.match(/^(?:culti milano\s+)?(decor|stile)(?![\p{L}\p{N}_])/u)?.[1] ?? null
  }
  if (field === 'family') return product.editorial.scentFamily
  if (field === 'category') return product.trade.category
  return product.editorial[field]
}

export function collectionProducts(products: readonly CatalogProduct[], collection: EditorialCollection): CatalogProduct[] {
  // Call with withValidImages output: eligibility must follow asset verification.
  if (isCommercialCollection(collection)) {
    const skus = new Set<string>()
    const slugs = new Set<string>()
    return storefrontProducts(products.filter(product => isPubliclyPurchasable(product) &&
      (collection.rule.field === 'note'
        ? collection.rule.values.some(note => verifiedNotesFor(product)?.notes.some(value => value === (note as VerifiedNote)))
        : collection.rule.values.includes(collectionValue(product, collection.rule.field) ?? '')))).filter(product => {
      if (skus.has(product.trade.sku) || slugs.has(product.editorial.slug)) return false
      skus.add(product.trade.sku)
      slugs.add(product.editorial.slug)
      return true
    })
  }
  if (collection.rule.field === 'researchSelection') return products
    .filter((product) => isPubliclyPurchasable(product) && demandRank(product.trade.sku) !== null)
    .sort((a, b) => demandRank(a.trade.sku)! - demandRank(b.trade.sku)!)
  if (collection.rule.field === 'demand') return merchProducts(storefrontProducts(products), 'popular')
  return storefrontProducts(products.filter((product) =>
    (product.trade.stock ?? 0) > 0 &&
    !collection.excludeCategories?.includes(product.trade.category) &&
    collection.rule.values.includes(collectionValue(product, collection.rule.field) ?? '')
  ))
}

export function availableCollections(products: readonly CatalogProduct[]) {
  return [...editorialCollections, ...commercialCollections, ...noteCollections]
    .map((collection) => ({ ...collection, products: collectionProducts(products, collection) }))
    .filter((collection) => collection.products.length >= (isCommercialCollection(collection) ? MIN_COMMERCIAL_PRODUCTS : 1))
}

export function collectionPath(slug: string): string {
  return `/collections/${slug}`
}


export function collectionsForProduct(product: CatalogProduct): EditorialCollection[] {
  if ((product.trade.stock ?? 0) <= 0 || product.editorial.images.length === 0) return []
  return editorialCollections.filter((collection) =>
    (collection.rule.field !== 'researchSelection' || isPubliclyPurchasable(product)) &&
    !collection.excludeCategories?.includes(product.trade.category) &&
    collection.rule.values.includes(collectionValue(product, collection.rule.field) ?? '')
  )
}

/** Link only when the destination exists in the same validated catalog snapshot. */
export function commercialCollectionsForProduct(product: CatalogProduct, products: readonly CatalogProduct[]) {
  if (!isPubliclyPurchasable(product)) return []
  return availableCollections(products).filter(collection => isCommercialCollection(collection) &&
    collection.products.some(item => item.trade.sku === product.trade.sku && item.editorial.slug === product.editorial.slug))
}
