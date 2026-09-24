import type { CatalogProduct } from './contracts'
import { reviewedTitle } from './reviewedContent'
import { demandRank } from './demandPriority'
import { confirmedProductTranslation } from './productTranslations'
import type { RawSearchParams } from './filterParams'
import { categoryLabels, labelFor } from './vocabulary'

export const brandPriority = ['CULTI MILANO', 'TEATRO Fragranze Uniche', 'Millefiori Milano', 'Lothantique', 'Christian Tortu', 'Castelbel', 'DANHERA', 'MAMI MILANO']

function brandRank(brand: string | null): number {
  const index = brandPriority.indexOf(brand ?? '')
  return index < 0 ? brandPriority.length : index
}

export function isDebugCatalog(params: RawSearchParams): boolean {
  return params.debugCatalog === '1'
}

/** Only local raster assets are supported by the existing image configuration. */
export function catalogImage(product: CatalogProduct): string | null {
  return product.editorial.images.find((image) => /^\/(?!\/)(?:[\w-]+\/)*[\w.-]+\.(?:webp|png|jpe?g|avif)$/i.test(image) && !image.includes('..')) ?? null
}

export function storefrontProducts(products: readonly CatalogProduct[], debug = false): CatalogProduct[] {
  return products.filter((product) => debug || catalogImage(product)).sort((a, b) => {
    // Internal merchandising signal first: researched higher-priority in-stock
    // products lead the default catalog; the rank itself is never displayed.
    const rankA = demandRank(a.trade.sku)
    const rankB = demandRank(b.trade.sku)
    if (rankA !== rankB) return (rankA ?? Number.MAX_SAFE_INTEGER) - (rankB ?? Number.MAX_SAFE_INTEGER)
    const brand = brandRank(a.trade.brand) - brandRank(b.trade.brand)
    if (brand !== 0) return brand
    const tieA = `${a.editorial.slug ?? ''}\u0000${a.trade.sku}`
    const tieB = `${b.editorial.slug ?? ''}\u0000${b.trade.sku}`
    return tieA < tieB ? -1 : tieA > tieB ? 1 : 0
  })
}

export function curatorSelection(products: readonly CatalogProduct[]): CatalogProduct[] {
  const brands = new Set<string>()
  return storefrontProducts(products).filter((product) => {
    const { description, scentFamily, mood, room } = product.editorial
    const brand = product.trade.brand
    if (!brand || brands.has(brand) || !description || !(scentFamily || mood || room)) return false
    brands.add(brand)
    return true
  }).slice(0, 4)
}

/** Presentation only: the complete source name remains available in product details. */
export function productPresentation(product: CatalogProduct) {
  const { name, brand, volume, category } = product.trade
  let title = name
  const aliases = [brand, brand === 'TEATRO Fragranze Uniche' ? 'TEATRO' : null, brand === 'Ladenac Milano' ? 'Ladenac' : null].filter(Boolean) as string[]
  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    title = title.replace(new RegExp(`(^|[\\s/,])${escaped}(?=$|[\\s/,])`, 'gi'), '$1')
  }
  title = title
    .replace(/^Hydro\s*\/\s*концентрат для арома лампы\s*/i, '')
    .replace(/(?:диффузор с палочками|рефилл? для (?:заправки )?диффузора|спрей для дома|аромадиффузор|ароматическая свеча|свеча (?:большая|маленькая|средняя)|сменный аромат для аромапопурри|сменный аромат|аромапопурри|ароматизатор воздуха|ароматическое саше|диффузор|room spray)/gi, '')
    .replace(/кар?тридж\s+[aа]g/gi, '')
    .replace(/\d+(?:[.,]\d+)?\s*(?:мл|ml|гр|г)(?=\s|[.,/]|$)/gi, '')
    .replace(/[,\s]*(?:пласт\.|пластик|ТМ)\s*$/gi, '')
    .replace(/^[\s/,]+|[\s/,.]+$/g, '')
    .replace(/\s+/g, ' ')
  // A bilingual label carries the same fragrance twice. Keep the first named part.
  title = title.split('/').map((part) => part.trim()).find(Boolean) ?? name
  title = title.replace(/[,.]?\s*(?:Luxury [CС]ollection|Christmas Collection|Коллекция .*)$/i, '').trim()
  const translation = confirmedProductTranslation(product.trade)
  return {
    title: reviewedTitle(product.trade) ?? translation?.original ?? (title || name),
    russianTitle: translation?.russian ?? null,
    subtitle: [labelFor(categoryLabels, category), category === 'Аксессуары' ? null : volume ?? name.match(/\d+(?:[.,]\d+)?\s*ml\b/i)?.[0]].filter(Boolean).join(' · '),
  }
}
